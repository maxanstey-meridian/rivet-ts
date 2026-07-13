# Complete Breaking Replacement of `Invoke`

**Status:** Implemented in `Rivet.Attributes` 0.41.0. This document remains the migration design and verification record.

## Decision

Replace every callback-based `Invoke` API with a contract-owned, two-phase endpoint API:

1. Input-bearing contracts bind their contract input.
2. Application and use-case code executes as ordinary C# outside Rivet.
3. The contract operation constructs one terminal Rivet result.
4. A host adapter converts that result to MVC or Minimal API output.

The target usage is fixed:

```csharp
var endpoint = Contract.Operation.Bind(input);

var outcome = await useCase.ExecuteAsync(..., ct);

return outcome switch
{
    Success success => endpoint.Success(Map(success)).ToActionResult(),
    Missing missing => endpoint.Error(404, Map(missing)).ToActionResult(),
    Invalid invalid => endpoint.Error(422, Map(invalid)).ToActionResult(),
    _ => throw new UnreachableException(),
};
```

Routes without contract input call terminal methods directly:

```csharp
var output = await useCase.ExecuteAsync(ct);

return Contract.Operation.Success(output).ToActionResult();
```

The complete terminal vocabulary is:

```csharp
endpoint.Success()
endpoint.Success(payload)
endpoint.Error(status)
endpoint.Error(status, payload)
endpoint.File(...)
```

The same methods are called directly on operations without input. `File(...)` is the dedicated contract-owned file result API described below.

The framework boundary remains:

```csharp
result.ToActionResult() // MVC
result.ToResult()       // Minimal APIs
```

This is a breaking replacement. There will be no `Invoke` compatibility layer, obsolete forwarding overloads, callback overloads, attributes, raw `IResult` path, native typed-result passthrough, response-union generic list, or alternative public execution API.

## Non-Negotiable Boundaries

- Rivet does not execute application behavior.
- Rivet does not receive callbacks, delegates, `Task`, or `ValueTask` from endpoint implementations.
- Input-bearing operations must be bound with `Bind(input)` before a terminal result can be created.
- No-input operations expose terminal methods directly and do not expose a meaningless parameterless `Bind()`.
- Application exceptions propagate through the application's existing exception handling. Terminal methods model known responses, not exception interception.
- Success responses are created only through `Success()` or `Success(payload)`.
- Declared non-success responses are created only through `Error(status)` or `Error(status, payload)`.
- Binary and file success responses are created only through the dedicated `File(...)` API.
- Native ASP.NET result types do not enter the Rivet API.
- MVC and Minimal API types are introduced only at `ToActionResult()` and `ToResult()`.
- Contract declarations remain the source of status, payload, media-type, and file constraints.

## Current Surface Being Replaced

`Rivet.Attributes/EndpointBuilder.cs` currently contains 29 public `Invoke` overloads across six route-definition variants:

| Current variant                    | Plain callback overloads |  Native typed-result overloads |  Total |
| ---------------------------------- | -----------------------: | -----------------------------: | -----: |
| `RouteDefinition<TInput, TOutput>` |                        1 | `Results<T1, ...>` arities 2-6 |      6 |
| `RouteDefinition<TOutput>`         |                        1 | one `IResult` plus arities 2-6 |      7 |
| `InputRouteDefinition<TInput>`     |                        1 | one `IResult` plus arities 2-6 |      7 |
| `RouteDefinition`                  |                        1 | one `IResult` plus arities 2-6 |      7 |
| `FileRouteDefinition`              |                        0 |        one arbitrary `IResult` |      1 |
| `FileRouteDefinition<TInput>`      |                        0 |        one arbitrary `IResult` |      1 |
| **Total**                          |                    **4** |                         **25** | **29** |

The replacement must retain the contract guarantees currently spread across:

- `Rivet.Attributes/EndpointBuilder.cs`
- `Rivet.Attributes/RivetResult.cs`
- `Rivet.Attributes/TypedResultValidator.cs`
- `Rivet.Attributes/RivetContractViolationException.cs`
- `Rivet.Attributes/RivetContractViolationHandler.cs`
- `Rivet.Tool/Analysis/CoverageChecker.cs`

The replacement deliberately does not retain callback execution or ASP.NET typed-result syntax.

### Current migration inventory

The implementation plan must account for the current working-tree usage rather than treating this as a local API rename:

| Repository             | Broad `Invoke` syntax matches | Native typed-result calls | Notes                                                                             |
| ---------------------- | ----------------------------: | ------------------------: | --------------------------------------------------------------------------------- |
| Rivet repository scope |                            78 |                        28 | Includes source, tests, tools, samples, and fixtures; classify before migration   |
| Casebridge             |                           118 |                         0 | Broad syntax count including unrelated delegate calls; classify before migration  |
| SpeechScribe           |                            32 |                        24 | Includes 46 `TypedResults` constructions and two `.SkipValidation()` declarations |
| Lagon                  |                             7 |                         0 | Includes tuple-based file adaptation                                              |
| **Broad syntax total** |                       **235** |                    **52** | Not a completion total until non-Rivet invocations and fixtures are classified    |

rivet-ts has two live documentation examples but no current scaffold emitter that generates `.Invoke()` syntax. Its scaffold lifecycle and golden tests remain mandatory regression gates.

The inventory must be regenerated from a checked-in or documented query that counts both `.Invoke(` and `.Invoke<`. Each result must be classified as a Rivet runtime call, a deliberate coverage/compile fixture, or an unrelated method with the same name. Only that classified inventory may be used as the migration completion gate.

## Public API

### Core result

Replace the current success-only `RivetResult`/`RivetResult<T>` transport with one closed public result root whose concrete cases are constructed only by route definitions:

```csharp
public abstract class RivetResult
{
    internal RivetResult() { }
}
```

Concrete success, error, and file cases remain inaccessible to consumers except through the terminal methods. Their internal state carries everything the host adapters require:

- selected status code;
- whether a body exists;
- declared payload type;
- payload value;
- selected response content type;
- file source and file metadata;
- route identity needed for violation messages.

Consumers receive `RivetResult` and can only adapt it. They do not construct arbitrary result cases or mutate status, payload, or media type.

### Bound types

Add these public bound operation types:

```csharp
public sealed class BoundRouteDefinition<TOutput>
public sealed class BoundRouteDefinition
public sealed class BoundFileRouteDefinition
```

Their constructors are internal. A bound instance is request-local and immutable. It retains the originating operation's immutable response metadata, but it does not need to retain the input value after `Bind` has established the compile-time input witness.

The bound types expose only terminal methods appropriate to their route shape. They do not expose contract builder methods such as `Status`, `Returns`, `Secure`, or `WithResponseHeader`.

### Input binding

```csharp
public sealed class RouteDefinition<TInput, TOutput>
{
    public BoundRouteDefinition<TOutput> Bind(TInput input);
}

public sealed class InputRouteDefinition<TInput>
{
    public BoundRouteDefinition Bind(TInput input);
}

public sealed class FileRouteDefinition<TInput>
{
    public BoundFileRouteDefinition Bind(TInput input);
}
```

`Bind`:

- applies the explicit null-input policy pinned in Phase 0;
- validates and publishes the definition before application execution begins;
- returns a fresh immutable bound operation;
- does not execute, transform, validate, or retain application behavior;
- does not perform MVC model binding;
- does not infer route, query, header, cookie, form, or body values;
- accepts the already-composed contract input, including composite route/body DTOs.

C# nullable-reference annotations on a constructed generic `TInput` are not reliably recoverable at runtime. Do not claim annotation-accurate null enforcement from `typeof(TInput)`. Before implementation begins, choose and test one honest rule: reject every null contract input, or add explicit declaration metadata for nullable contract input. Nullable value types can be identified normally. This decision does not add another execution API.

Example:

```csharp
var endpoint = MembersContract.UpdateRole.Bind(
    new UpdateRoleInput(id, request.Role)
);

await updateRole.ExecuteAsync(id, request.Role, ct);

return endpoint.Success().ToActionResult();
```

### Success terminals

The six route-definition variants expose success terminals as follows:

| Route shape                        | Terminal surface                                                   |
| ---------------------------------- | ------------------------------------------------------------------ |
| `RouteDefinition<TInput, TOutput>` | `Bind(TInput)` -> `BoundRouteDefinition<TOutput>.Success(TOutput)` |
| `RouteDefinition<TOutput>`         | `Success(TOutput)`                                                 |
| `InputRouteDefinition<TInput>`     | `Bind(TInput)` -> `BoundRouteDefinition.Success()`                 |
| `RouteDefinition`                  | `Success()`                                                        |
| `FileRouteDefinition<TInput>`      | `Bind(TInput)` -> `BoundFileRouteDefinition.File(...)`             |
| `FileRouteDefinition`              | `File(...)`                                                        |

`Success()`:

- is available only for bodyless success declarations;
- uses the operation's resolved success status, including method defaults and `.Status(...)` overrides;
- creates a bodyless result;
- rejects a file-declared operation at runtime where fluent `.ProducesFile(...)` prevents compile-time specialization.

`Success(payload)`:

- is available only where the route definition has `TOutput`;
- accepts exactly `TOutput` at compile time;
- uses the resolved success status;
- uses the declared success response content type;
- applies runtime-value validation before returning the result;
- rejects file-declared operations, which must use `File(...)`.

An operation carrying `.SuppressImplicitResponse()` has no callable success terminal at runtime. The CLR method remains present because suppression is fluent runtime state, but `Success()` and `Success(payload)` throw `RivetContractViolationException`. The operation can still bind input and terminate through a declared `Error(...)`. This preserves imported response sets that intentionally contain no success response without inventing one.

Examples:

```csharp
var result = await getSubmission.ExecuteAsync(formId, id, ct);

return SubmissionsContract.Get
    .Success(Map(result))
    .ToActionResult();
```

```csharp
var endpoint = SubmissionsContract.ChangeStatus.Bind(request);

await changeSubmissionStatus.ExecuteAsync(
    new ChangeSubmissionStatusCommand(formId, id, request.Status, request.Comment),
    ct
);

return endpoint.Success().ToActionResult();
```

### Error terminals

Every route-definition and bound route-definition variant exposes:

```csharp
RivetResult Error(int status);

RivetResult Error<TError>(int status, TError payload);
```

These are the only explicit alternate-response terminals.

`Error(status)`:

- resolves a bodyless response declaration for the concrete runtime status;
- rejects the success status;
- rejects undeclared statuses;
- rejects declarations that require a payload.

`Error(status, payload)`:

- resolves a typed response declaration for the concrete runtime status;
- rejects the success status;
- rejects undeclared statuses;
- validates the supplied generic and runtime payload type against the declared response type;
- rejects a payload where the status is declared bodyless;
- selects the declared media type for that status where runtime metadata exists.

`Error(int, ...)` resolves current concrete and imported string-key declarations in this precedence order:

1. Exact concrete status, such as `404`.
2. Matching status range, such as `4XX`.
3. `default`.
4. Otherwise throw an undeclared-status contract violation.

An exact declaration always wins over a range, and a range always wins over `default`. Invalid status keys remain declaration diagnostics and never participate in runtime matching. This improves the current typed-result validator, which only compares exact integer statuses, and makes the current `Returns(string statusKey, ...)` surface executable without changing the agreed terminal API.

Example:

```csharp
var endpoint = RecordingsContract.Delete.Bind(new DeleteRecordingRequest(id));
var outcome = await deleteRecording.ExecuteAsync(id, ct);

return outcome switch
{
    DeleteRecordingResult.Success =>
        endpoint.Success().ToActionResult(),

    DeleteRecordingResult.NotFound =>
        endpoint.Error(404, new NotFoundDto("Recording not found.")).ToActionResult(),

    _ => throw new UnreachableException(),
};
```

### Dedicated file terminals

`File(...)` is the only successful file/binary response API. It is contract-owned and returns `RivetResult`; it never accepts or returns MVC `FileResult`, Minimal API `IResult`, or any native ASP.NET file result.

Support dedicated overloads for the current useful file source shapes:

```csharp
RivetResult File(
    byte[] content,
    string? downloadName = null,
    bool enableRangeProcessing = false,
    DateTimeOffset? lastModified = null,
    string? entityTag = null
);

RivetResult File(
    Stream content,
    string? downloadName = null,
    bool enableRangeProcessing = false,
    DateTimeOffset? lastModified = null,
    string? entityTag = null
);

RivetResult File(
    string physicalPath,
    string? downloadName = null,
    bool enableRangeProcessing = false,
    DateTimeOffset? lastModified = null,
    string? entityTag = null
);
```

The terminal parses and validates `entityTag` at construction using HTTP entity-tag grammar. Do not defer malformed validator failure until adapter execution.

If virtual-file support is required by an inspected current consumer, add a dedicated file source overload within this same `File(...)` family. Do not add a raw framework-result escape hatch.

The content type comes from the contract operation's `.ContentType(...)`, `.ProducesFile(...)`, or imported binary response metadata. It is not supplied independently by endpoint code. This prevents the runtime response from contradicting the contract.

The file result stores source and metadata; the MVC or Minimal adapter creates the native host file result at execution time. This preserves:

- byte-array and stream responses;
- physical file responses;
- content disposition and download filename;
- ETag and last-modified support;
- optional range processing;
- host-owned 200/206 selection;
- `Content-Range`, `Accept-Ranges`, and 416 behavior;
- optimized host file sending where applicable.

File terminal validation requires the operation to declare binary/file success metadata. Ordinary JSON success methods reject file-declared operations. File operations use the normal `Error(...)` methods for declared non-success responses.

Imported non-GET binary operations currently represented by an ordinary route definition plus `.ProducesFile(...)` must also expose the dedicated `File(...)` terminal. Because fluent state cannot change a CLR return type, the ordinary route-definition types may expose the same `File(...)` family and enforce file declaration at runtime. This is still one dedicated file API, not an escape hatch.

Protocol statuses produced by range processing are not application error branches. The adapter owns 200/206/416 protocol behavior while the contract continues to describe the file response and any explicitly declared application errors.

### Content types

Terminal methods derive content type from contract metadata:

- ordinary typed payloads default to `application/json`;
- `.ProducesContentType(...)` overrides success media type;
- declared error response content metadata determines error media type;
- file terminals use the declared file media type;
- a bodyless terminal emits no body media type.

`Success(payload)` supports declared textual payloads such as `string` with `text/plain` or `text/html`; it does not force every typed payload through JSON. The adapters serialize or write the payload according to the selected contract media type.

Where imported OpenAPI metadata declares multiple media types for the same status, the runtime terminal selects a representation in this order: explicit `.ProducesContentType(...)`, then `application/json` when declared, then the sole declared media type. Multiple remaining non-JSON representations are ambiguous and terminal construction throws a contract violation requiring an explicit primary runtime content type. Existing runtime APIs do not provide lossless negotiation among multiple same-status representations. The replacement must not invent a media-type selector outside the agreed terminal API. Preserve the complete content map for OpenAPI emission while documenting the deterministic runtime representation.

### Response headers

Current `.WithResponseHeader(...)` metadata is explicitly spec-only: Rivet neither receives header values nor validates their presence. Preserve that behavior honestly.

- Runtime results do not need to carry spec-only header declarations and never invent values for them.
- Adapters must not clear headers already set by endpoint or middleware code.
- Endpoint code continues to set dynamic values such as `Location`, `ETag`, `Retry-After`, cookies, and authentication challenge headers through ordinary host APIs before returning the Rivet result.
- `required: true` remains an explicit contract promise and OpenAPI fact, not a runtime guarantee.
- Documentation and tests must state this boundary rather than implying terminal methods synthesize unknown values.

Example:

```csharp
Response.Headers.Location = location;

return endpoint.Success(response).ToActionResult();
```

Authentication challenge/sign-out and cookie behavior follow the same rule. The endpoint performs the host operation as ordinary C# outside Rivet, then returns the contract's declared `Success(...)` or `Error(...)`. No native result is passed through Rivet.

### Authentication challenge migration

SpeechScribe currently returns `ChallengeHttpResult` through `Invoke` and uses `.SkipValidation()` because that native result does not expose status metadata Rivet can validate. The replacement removes both mechanisms.

The login contract must declare the concrete redirect status produced by its OIDC challenge rather than retaining its current implicit `200`:

```csharp
public static readonly RouteDefinition Login =
    Define.Get(LoginRoute)
        .Status(StatusCodes.Status302Found)
        .Summary("Start the OpenID Connect login flow");
```

The controller performs the host challenge as ordinary C# and then returns the matching contract-owned terminal result:

```csharp
[AllowAnonymous]
[HttpGet(AuthContract.LoginRoute)]
public async Task<IActionResult> Login()
{
    var properties = new AuthenticationProperties
    {
        RedirectUri = options.Value.PostLoginRedirectUrl,
    };

    await HttpContext.ChallengeAsync(
        OpenIdConnectDefaults.AuthenticationScheme,
        properties
    );

    return AuthContract.Login.Success().ToActionResult();
}
```

Add an integration tracer proving that the OIDC handler establishes `302` and `Location`, the Rivet adapter preserves both, and the response is not written twice. If the challenge handler has already established a response, the adapter may preserve that response only when its status matches the terminal result; a mismatch is a contract violation. This behavior belongs inside the first-party adapters and does not create a passthrough API.

“Already established” must be tested at result execution using the actual `HttpResponse`: whether `HasStarted` is true, the current status, existing headers, and whether the terminal would write a body. A matching bodyless terminal may preserve host-established status and headers; an adapter must never silently discard a terminal body or accept a mismatched status merely because host code touched the response.

Logout remains an ordinary host sign-out followed by `Success(payload)`. Its integration test must prove that the sign-out cookie survives adaptation.

## Publication and Immutability

Preserve shared static definition immutability without wrapping application execution.

### Input-bearing operations

`Bind(input)` is the publication point:

1. Validate delayed declaration invariants, including success/error status collision.
2. Atomically mark the shared definition as published.
3. Reject every subsequent builder mutation.
4. Return a request-local immutable bound operation.

Publication happens before application execution because callers bind before invoking the use case.

### No-input operations

The terminal `Success`, `Error`, or `File` call is the publication point. This necessarily occurs after ordinary application execution in the canonical endpoint shape. If application execution throws before a terminal result is created, the operation has not participated in a response and is not published by that request.

This is an intentional consequence of removing callback execution. Do not add a parameterless `Bind()`, `Publish()`, attribute, filter, or callback solely to preserve the old timing.

Builder invariants should be made eager where possible so a malformed static declaration fails during its fluent construction rather than after application side effects. Any invariant that necessarily remains delayed must be rechecked by every publication path.

Publication remains idempotent and thread-safe. Repeated binds and terminal calls are valid; mutation after the first publication is not.

### Immutable published snapshot

Bound operations and terminal methods must validate against one immutable snapshot rather than repeatedly consulting mutable builder fields:

```csharp
internal sealed record EndpointContract(
    string Method,
    string Route,
    ResponseContract? Success,
    ResponseSet AlternateResponses,
    FileContract? File
);

internal sealed record ResponseContract(
    string StatusKey,
    int? StatusCode,
    Type? PayloadType,
    IReadOnlyDictionary<string, ResponseRepresentation> Content
);

internal sealed record ResponseSet(
    IReadOnlyDictionary<int, ResponseContract> Exact,
    IReadOnlyDictionary<int, ResponseContract> Ranges,
    ResponseContract? Default
);
```

The concrete `ResponseRepresentation` and `FileContract` shapes must be pinned from the completed response-set implementation before coding this replacement. They must preserve enough information to distinguish JSON, textual, and binary representations and to retain every declared media type for emission fidelity. Do not collapse an imported content map to one string while publishing the runtime snapshot.

`Success` is nullable because `.SuppressImplicitResponse()` deliberately removes the callable success response. Publication validates and normalizes exact, range, and default response declarations once. Bound objects retain this snapshot but do not retain the input value.

Runtime terminal selection remains deterministic: explicit `.ProducesContentType(...)` first, otherwise `application/json` when declared, otherwise the sole declared media type. Multiple remaining non-JSON representations are rejected as ambiguous until the contract selects one explicitly. The complete map remains available to the contract pipeline even though the terminal API does not expose content negotiation.

## Runtime Validation

Move validation from post-hoc inspection of arbitrary ASP.NET results to construction of Rivet-owned results.

### Required validation

At `Bind`:

- the operation is structurally valid;
- delayed success/error collisions are rejected;
- the supplied input is compatible with `TInput`;
- publication occurs.

At `Success()`:

- the operation has a callable success response and has not suppressed it;
- the operation declares bodyless success;
- the resolved success status is used;
- the operation is not file/binary success.

At `Success(payload)`:

- the operation has a callable success response and has not suppressed it;
- the operation declares `TOutput`;
- the payload is present where required;
- the payload runtime type cannot leak undeclared derived members;
- polymorphic, abstract, interface, `object`, and nullable behavior retains the current honest exceptions;
- the selected content type matches contract metadata;
- the operation is not file/binary success.

At `Error(status)` and `Error(status, payload)`:

- status is not the success status;
- the declaration resolves by exact status, matching `nXX` range, then `default`;
- payload presence matches the declaration;
- payload type and runtime value match the declaration;
- selected content type matches contract metadata.

At `File(...)`:

- file/binary success is declared;
- source is non-null and valid for its source kind;
- the declared file content type is present;
- range processing is rejected for an unsupported/non-seekable source where the host cannot implement it honestly;
- entity tags are parsed and validated at terminal construction;
- filename and validators are carried unchanged to the adapter.

### Validation failures

Continue using `RivetContractViolationException` and the structured `contract_violation` 500 handler for contract/runtime contradictions. Application exceptions remain unrelated and continue through normal application exception handling.

### Validation opt-out

Delete `.SkipValidation()`.

It exists to admit native framework results that do not expose inspectable status metadata, including challenge and sign-out results. The replacement has no native result passthrough, so there is no valid reason to disable contract-owned result validation.

## Host Adapters

Ship first-party adapters in `Rivet.Attributes`; remove project-local bridge implementations from samples and migrate consumers to the package adapters.

### MVC

```csharp
public static IActionResult ToActionResult(this RivetResult result);
```

The MVC adapter lowers:

- bodyless results to `StatusCodeResult` or an equivalent contract-owned MVC result;
- body results to the appropriate status/body/content-type result;
- file results to native MVC file results with range, filename, ETag, and last-modified metadata;
- pre-existing host response headers without clearing them.

### Minimal APIs

```csharp
public static IResult ToResult(this RivetResult result);
```

The Minimal adapter implements the same wire semantics using Minimal API result execution. The public endpoint code does not mention native `TypedResults`, `Results<T1, ...>`, or any framework result union.

### Adapter parity

Given the same `RivetResult`, MVC and Minimal adapters must produce equivalent:

- status;
- body presence;
- serialized payload shape;
- content type;
- preserved headers;
- file metadata;
- range behavior within host capabilities.

## Six-Variant Implementation Matrix

| Current variant                    | New binding API                                   | Success API               | Error API                                | File API                                                                  |
| ---------------------------------- | ------------------------------------------------- | ------------------------- | ---------------------------------------- | ------------------------------------------------------------------------- |
| `RouteDefinition<TInput, TOutput>` | `Bind(TInput)` -> `BoundRouteDefinition<TOutput>` | bound `Success(TOutput)`  | bound `Error(int)` / `Error<T>(int, T)`  | bound `File(...)` only when `.ProducesFile(...)` declares binary success  |
| `RouteDefinition<TOutput>`         | none                                              | direct `Success(TOutput)` | direct `Error(int)` / `Error<T>(int, T)` | direct `File(...)` only when `.ProducesFile(...)` declares binary success |
| `InputRouteDefinition<TInput>`     | `Bind(TInput)` -> `BoundRouteDefinition`          | bound `Success()`         | bound `Error(int)` / `Error<T>(int, T)`  | bound `File(...)` only when `.ProducesFile(...)` declares binary success  |
| `RouteDefinition`                  | none                                              | direct `Success()`        | direct `Error(int)` / `Error<T>(int, T)` | direct `File(...)` only when `.ProducesFile(...)` declares binary success |
| `FileRouteDefinition<TInput>`      | `Bind(TInput)` -> `BoundFileRouteDefinition`      | none                      | bound `Error(int)` / `Error<T>(int, T)`  | bound `File(...)`                                                         |
| `FileRouteDefinition`              | none                                              | none                      | direct `Error(int)` / `Error<T>(int, T)` | direct `File(...)`                                                        |

The ordinary variants expose `File(...)` only because imported non-GET binary operations currently use `.ProducesFile(...)` without changing the route-definition CLR type. Calling it without binary/file declaration is a contract violation. Calling ordinary `Success` on a file-declared operation is also a contract violation.

## Full `Invoke` Parity Matrix

| Current overload family                                                                | Current capability                                                                   | Breaking replacement                                                                                                                      |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `RouteDefinition<TInput,TOutput>.Invoke(input, Func<TInput,Task<TOutput>>)`            | Input witness, application execution, typed success payload, contract success status | `var endpoint = operation.Bind(input); var output = await application(...); return endpoint.Success(output).ToActionResult()/ToResult();` |
| `RouteDefinition<TInput,TOutput>.Invoke<T1,T2>(input, Func<...,Task<Results<T1,T2>>>)` | Input witness plus two native success/error branches                                 | Bind, execute, map each known branch to bound `Success(payload)` or `Error(status[, payload])`                                            |
| Same, arity 3                                                                          | Three native branches                                                                | Same terminal mapping; no response-union arity exists in new API                                                                          |
| Same, arity 4                                                                          | Four native branches                                                                 | Same terminal mapping; no response-union arity exists in new API                                                                          |
| Same, arity 5                                                                          | Five native branches                                                                 | Same terminal mapping; no response-union arity exists in new API                                                                          |
| Same, arity 6                                                                          | Six native branches                                                                  | Same terminal mapping; no response-union arity exists in new API                                                                          |
| `RouteDefinition<TOutput>.Invoke(Func<Task<TOutput>>)`                                 | Application execution, typed success payload, contract success status                | Execute normally, then direct `Success(output)`                                                                                           |
| `RouteDefinition<TOutput>.Invoke<T1>(Func<Task<T1>>)`                                  | One native result branch                                                             | Execute normally, classify the known outcome, then direct `Success(payload)` or `Error(status[, payload])`                                |
| Same, `Results<T1,T2>`                                                                 | Two native branches                                                                  | Direct terminal mapping                                                                                                                   |
| Same, arity 3                                                                          | Three native branches                                                                | Direct terminal mapping                                                                                                                   |
| Same, arity 4                                                                          | Four native branches                                                                 | Direct terminal mapping                                                                                                                   |
| Same, arity 5                                                                          | Five native branches                                                                 | Direct terminal mapping                                                                                                                   |
| Same, arity 6                                                                          | Six native branches                                                                  | Direct terminal mapping                                                                                                                   |
| `InputRouteDefinition<TInput>.Invoke(input, Func<TInput,Task>)`                        | Input witness, application execution, bodyless success                               | Bind, execute normally, bound `Success()`                                                                                                 |
| `InputRouteDefinition<TInput>.Invoke<T1>(input, Func<...,Task<T1>>)`                   | Input witness plus one native branch                                                 | Bind, execute, map to bound `Success()` or `Error(status[, payload])`                                                                     |
| Same, `Results<T1,T2>`                                                                 | Two native branches                                                                  | Bound terminal mapping                                                                                                                    |
| Same, arity 3                                                                          | Three native branches                                                                | Bound terminal mapping                                                                                                                    |
| Same, arity 4                                                                          | Four native branches                                                                 | Bound terminal mapping                                                                                                                    |
| Same, arity 5                                                                          | Five native branches                                                                 | Bound terminal mapping                                                                                                                    |
| Same, arity 6                                                                          | Six native branches                                                                  | Bound terminal mapping                                                                                                                    |
| `RouteDefinition.Invoke(Func<Task>)`                                                   | Application execution and bodyless success                                           | Execute normally, then direct `Success()`                                                                                                 |
| `RouteDefinition.Invoke<T1>(Func<Task<T1>>)`                                           | One native branch                                                                    | Execute normally, map to direct `Success()` or `Error(status[, payload])`                                                                 |
| Same, `Results<T1,T2>`                                                                 | Two native branches                                                                  | Direct terminal mapping                                                                                                                   |
| Same, arity 3                                                                          | Three native branches                                                                | Direct terminal mapping                                                                                                                   |
| Same, arity 4                                                                          | Four native branches                                                                 | Direct terminal mapping                                                                                                                   |
| Same, arity 5                                                                          | Five native branches                                                                 | Direct terminal mapping                                                                                                                   |
| Same, arity 6                                                                          | Six native branches                                                                  | Direct terminal mapping                                                                                                                   |
| `FileRouteDefinition.Invoke(Func<Task<TResult>>)`                                      | Native file success or native declared error                                         | Execute normally; direct `File(...)` for success or direct `Error(status[, payload])` for declared failure                                |
| `FileRouteDefinition<TInput>.Invoke(input, Func<TInput,Task<TResult>>)`                | Input witness, native file success or declared error                                 | Bind, execute normally; bound `File(...)` for success or bound `Error(status[, payload])` for declared failure                            |

Cross-cutting parity:

| Current behavior                                             | Replacement behavior                                                                         |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Handler exceptions propagate                                 | Ordinary application exceptions propagate before any terminal result                         |
| Success status comes from contract in plain `Invoke`         | Every `Success` uses the contract's resolved success status                                  |
| Native result status is checked against contract             | Callers cannot supply success status; `Error` validates an explicit declared status          |
| Native payload type is inspected                             | Terminal generic signature and runtime-value validation enforce payload type                 |
| Body on bodyless declaration is rejected                     | Bodyless routes expose only `Success()`; `Error` overload validates body presence            |
| Six-union overload ceiling                                   | No union list and no branch-count ceiling                                                    |
| Native file content type is compared                         | File content type comes from the contract and cannot diverge                                 |
| Native file result owns 200/206                              | Adapter-owned native file execution owns 200/206                                             |
| `.SkipValidation()` bypasses uninspectable framework results | No bypass; host side effects happen outside Rivet and terminal result remains contract-owned |
| `.Invoke()` marks coverage                                   | Semantic direct/bound terminal calls establish coverage                                      |
| Exact-only runtime error lookup                              | `Error(int, ...)` resolves exact, then matching `nXX`, then `default`                        |
| Suppressed implicit response is declaration metadata         | Success terminals reject it; declared error terminals remain usable                          |

## Roslyn Coverage Analysis

Replace name-based `.Invoke()` discovery in `Rivet.Tool/Analysis/CoverageChecker.cs` with semantic terminal-flow analysis.

### Direct terminal calls

Recognize semantically resolved calls where the receiver is a contract field:

```csharp
Contract.Operation.Success(...)
Contract.Operation.Error(...)
Contract.Operation.File(...)
```

Associate the terminal invocation with the exact `IFieldSymbol`, then preserve method/route comparison across MVC, Minimal API, and Azure Functions route contexts.

### Bound terminal calls

Recognize:

```csharp
var endpoint = Contract.Operation.Bind(input);
return endpoint.Success(...).ToActionResult();
```

Track the bound local's reaching definition back to the exact contract field. Support:

- local declaration with initializer;
- assignment before terminal use;
- expression-bodied actions and mapped lambdas;
- direct chains such as `Contract.Operation.Bind(input).Success(...)`;
- success, error, and file terminals;
- MVC controller actions;
- Minimal API `MapGet`, `MapPost`, `MapPut`, `MapPatch`, `MapDelete`, and `MapMethods` handlers. ASP.NET Core 8-10 expose no first-party `MapHead` or `MapOptions`; HEAD and OPTIONS are represented through semantically resolved `MapMethods` verb arrays.
- Azure Functions isolated-worker methods using `[Function]` and `[HttpTrigger]`, including route and verb extraction from the trigger attribute.

Do not count `Bind` alone as implementation coverage. A route is implemented only when a reachable terminal result is returned from the route handler.

Do not count:

- methods named `Bind`, `Success`, `Error`, or `File` on non-Rivet types;
- terminal calls not derived from a `[RivetContract]` operation field;
- a bound operation created but never terminated;
- terminal results created outside a resolvable MVC, Minimal API, or Azure Functions HTTP route context.

### Coverage validation

For every terminal call:

- preserve HTTP method mismatch detection;
- preserve normalized route mismatch detection;
- preserve the same checks for Azure Functions HTTP triggers rather than treating them as terminal calls outside a known route context;
- report missing implementation when no direct or bound terminal reaches the route;
- report multiple implementations consistently with current behavior;
- report an orphaned `Bind` diagnostic rather than treating it as coverage;
- report terminal use from the wrong bound operation when symbol flow is inconsistent;
- keep analysis bounded and deterministic.

Use semantic symbols, not identifier text. Add PDG/data-flow logic only as needed for local bound-operation tracking; do not introduce attributes as a shortcut.

## Implementation Sequence

Use tracer tests and keep each slice compiling before expanding the migration.

### Phase 0: Stabilize the implementation base

The current Rivet worktree contains substantial uncommitted response-set, schema, content-map, and provenance work, including edits to `Endpoint.cs` and `EndpointBuilder.cs`. Complete or checkpoint that work before implementing this replacement so the two changes do not overwrite one another.

1. Record the current build and test state, including strict corpus failures.
2. Checkpoint the current response-set implementation.
3. Re-read the final `EndpointBuilder` status-key, content-map, header, binary, and suppression metadata.
4. Pin the normalized response algebra used by the immutable runtime snapshot without reducing complete content maps to one media type.
5. Pin the null-input rule: reject every null contract input, or add explicit nullable-input declaration metadata. Do not infer nullable-reference intent from `typeof(TInput)`.
6. Generate and classify the `.Invoke(` plus `.Invoke<` migration inventory with a reproducible query.
7. Record package acquisition and version-update steps for each external consumer.
8. Implement this plan from that stable revision.

Exit gate: the replacement starts from a reproducible commit containing the current response-set model, with response algebra, null-input behavior, migration inventory, and package rollout pinned.

### Phase 1: Pin the public type model

1. Add compile fixtures for the exact allowed examples.
2. Add negative compile fixtures proving the forbidden surface is absent.
3. Introduce the closed `RivetResult` root and internal ordinary/file result cases.
4. Introduce `BoundRouteDefinition<TOutput>`, `BoundRouteDefinition`, and `BoundFileRouteDefinition`.
5. Add `Bind` to the three input-bearing variants.
6. Add the exact success/error terminal matrix to all six variants.
7. Add the dedicated `File(...)` family.

Exit gate: every desired example compiles without callbacks or native results, and forbidden examples do not compile.

The old and new public surfaces may coexist only transiently on this unreleased implementation branch while the Rivet tests and samples are converted. This is not a compatibility period, must not be published, and must end before the breaking package is produced.

### Phase 2: Contract-owned validation

1. Extract reusable declared-payload runtime-value checks from `TypedResultValidator` without retaining ASP.NET result inspection.
2. Introduce the immutable `EndpointContract`, complete response-set snapshot, representation metadata, and file metadata pinned in Phase 0.
3. Normalize exact, `nXX`, and `default` declarations during publication.
4. Implement eager `Bind` validation and publication.
5. Implement direct terminal publication for no-input operations.
6. Implement success status/body/type/content validation, including suppressed-success rejection.
7. Implement exact/range/default declared-error status/body/type/content validation.
8. Implement dedicated file source and metadata validation.
9. Preserve `RivetContractViolationException` and handler behavior.

Snapshot publication must be atomic and thread-safe. Do not carry the current plain `_published` Boolean implementation forward.

Exit gate: all current enforcement-honesty semantics are represented by terminal-construction tests.

### Phase 3: MVC and Minimal adapters

1. Add first-party `ToActionResult()`.
2. Add first-party `ToResult()`.
3. Implement ordinary JSON, textual, and bodyless responses.
4. Implement byte, stream, and physical-file lowering.
5. Implement filename, content disposition, ETag, last-modified, and range processing.
6. Preserve host-set headers and cookies.
7. Preserve an already-established host response only when its status matches the Rivet terminal result; reject mismatches.
8. Add the OIDC challenge and sign-out cookie tracers.
9. Add equivalent MVC and Minimal integration tests.

Exit gate: both hosts emit equivalent wire responses from the same Rivet results.

### Phase 4: Coverage analysis

1. Add red tests for direct terminal coverage.
2. Add red tests for bound local coverage.
3. Add red tests for direct chained binding and terminals.
4. Add red tests for orphaned binding and non-Rivet lookalikes.
5. Replace `.Invoke()` scanning with semantic terminal-flow analysis.
6. Preserve route/method validation for MVC, Minimal APIs, and Azure Functions isolated-worker HTTP triggers.
7. Resolve HEAD and OPTIONS through first-party `MapMethods`; do not invent nonexistent `MapHead` or `MapOptions` APIs.

Exit gate: coverage has no `.Invoke()` dependency, no false coverage from `Bind` alone, and no regression for Lagan's `[HttpTrigger]` endpoints.

### Phase 5: Internal Rivet migration

1. Migrate all samples.
2. Migrate ImportDemo endpoint examples.
3. Replace project-local sample adapters with first-party adapters.
4. Rewrite runtime validation tests around contract-owned outcomes.
5. Rewrite publication/immutability tests around `Bind` and terminal calls.
6. Rewrite coverage fixtures.
7. Update comments in `Endpoint.cs`, `EndpointBuilder.cs`, and `ContractWalker.cs`.
8. Delete all 29 `Invoke` overloads.
9. Delete all four private `InvokeTypedResult` helpers.
10. Delete native `IResult` and `Results<T1, ...>` dependencies from route definitions.
11. Delete `TypedResultValidator` after moving only framework-independent value checks into the new validator.
12. Delete union unwrapping and ASP.NET result introspection.
13. Delete `.SkipValidation()`, `_skipValidation`, `ShouldSkipValidation`, state copying, docs, and tests.
14. Delete old success-only `RivetResult<T>` after the closed result root replaces it.
15. Delete project-local sample adapters and native `IResult` wrapper adapters.
16. Delete dead typed-result test fixtures after their semantic assertions exist in terminal-result tests.
17. Remove every package and documentation reference to callback execution.

Do not leave obsolete aliases, forwarding methods, compatibility packages, migration shims, or parallel result models.

Exit gate: no intentional Rivet runtime/example/test use of `.Invoke()` remains, the old model is absent, and the repository is ready to produce one breaking package.

### Phase 6: Produce the breaking package

1. Bump `Rivet.Attributes` to the explicitly selected breaking version.
2. Pack and test the exact multi-target package artifact that consumers will restore.
3. Publish it to the configured package feed or place it in a controlled local feed available to every consumer migration.
4. Record the exact package source and version used for each consumer verification run.
5. Do not release any intermediate package containing both `Invoke` and the terminal API.

Exit gate: one immutable package artifact containing only the new execution model is available to all consumer repositories.

### Phase 7: Consumer migrations

Migrate consumers by behavior, not mechanical syntax.

#### Casebridge

- Replace the wildcard `Rivet.Attributes` reference with the explicit breaking version for the migration and verification run.
- Convert plain callback bodies into ordinary use-case execution followed by `Success`.
- Bind explicit body/composite input before use-case execution.
- Preserve route/query values used outside contract input exactly; do not invent new DTOs as part of this refactor.
- Preserve existing domain-exception mapping.
- Convert known explicit endpoint outcomes to `Error` only where controllers already own that mapping.
- Preserve response cookies and headers as host side effects before adaptation.
- Move contract-declared file routes to the dedicated file API.

#### SpeechScribe

- Update the pinned `Rivet.Attributes` package from `0.37.0` to the exact breaking version.
- Replace every `TypedResults`/`Results<T1, ...>` switch arm with `Success` or `Error`.
- Preserve exhaustive domain outcome switches and unreachable fallbacks.
- Change the login contract from implicit `200` plus `.SkipValidation()` to its actual declared OIDC redirect status.
- Execute `HttpContext.ChallengeAsync(...)` as ordinary host code, then return matching `Success()`; prove `Location` and status survive without a double write.
- Execute sign-out as ordinary host code, then return `Success(payload)`; prove the cookie survives adaptation.
- Remove the native `IResult` MVC bridge.
- Move file responses to the dedicated file API.

#### Lagon

- Update the pinned `Rivet.Attributes` package from `0.36.1` to the exact breaking version.
- Bind multipart/composite input after parsing and before use-case execution.
- Convert known declared 400/409/500 outcomes to `Error`; keep unknown failures exceptional.
- Replace tuple-based file output and `ToFileResult` with the dedicated file API.
- Retain `ToActionResult` as the host boundary using the first-party adapter.

#### rivet-ts documentation and scaffolding

- Update `marketing.md` and `docs/guides/dotnet-handoff.md` examples.
- Inspect every scaffold emitter and golden fixture for generated .NET handoff/example syntax.
- Emit `Bind`, ordinary application execution, contract-owned terminals, and `ToActionResult`/`ToResult` wherever .NET implementation examples are generated.
- Preserve the scaffold lifecycle zero-plumb gate.

Exit gate: all known consumer repositories compile and their endpoint/integration suites pass without `Invoke` or native result unions.

## Test Plan

### Public API compile tests

Positive compile cases:

- every one of the six route-definition variants;
- input binding with exact input type;
- bodyless success;
- typed success;
- bodyless error;
- typed error;
- byte file;
- stream file;
- physical file;
- MVC adaptation;
- Minimal adaptation.

Negative compile/API cases:

- no `Invoke` member;
- no callback overload on `Bind`, `Success`, `Error`, or `File`;
- no native `IResult` argument or return path;
- no `TypedResults`/`Results<T1, ...>` surface;
- input-bearing operation cannot call ordinary success before binding;
- bound typed-output route cannot omit success payload;
- bound bodyless route cannot pass success payload;
- wrong input type cannot bind;
- wrong success compile-time type cannot be passed;
- no generic response-union list;
- no compatibility API.

### Runtime terminal tests

- method-default success statuses, including POST 201 and bodyless DELETE 204;
- custom `.Status(...)` success;
- duplicate and colliding response declarations;
- exact typed success payload;
- the Phase 0 null-input policy on every input-bearing route shape;
- null payload behavior;
- runtime derived-type leak rejection;
- allowed polymorphic, abstract, interface, object, and nullable payloads;
- bodyless success cannot emit a body;
- `.SuppressImplicitResponse()` rejects both success terminals while declared errors remain callable;
- undeclared error status rejection;
- exact status declarations beat matching `nXX` declarations;
- matching `nXX` declarations beat `default`;
- `default` handles an otherwise undeclared concrete status;
- invalid status keys never participate in runtime matching;
- payload on bodyless error rejection;
- missing payload on typed error rejection;
- wrong error payload rejection;
- string status-key runtime behavior;
- JSON and explicit textual content types;
- explicit, JSON-preferred, and sole-representation runtime media selection;
- ambiguous multiple non-JSON representations require an explicit primary content type;
- file declaration required for `File(...)`;
- ordinary `Success` rejected for file declarations;
- file source validation;
- contract violation envelope.

### Publication tests

- input route publishes at `Bind` before use-case execution;
- no-input route publishes at terminal construction;
- all mutators reject changes after publication;
- repeated binds and terminal calls are valid;
- concurrent first publication is safe;
- delayed declaration collision is checked on every publication path;
- `Bind` without terminal does not count as coverage despite publishing runtime state.

### Adapter integration tests

For both MVC and Minimal APIs:

- JSON body and status;
- bodyless 204;
- custom 201;
- typed and bodyless errors;
- textual content;
- host-set response headers and cookies survive;
- a host-established matching challenge response preserves status and `Location`;
- a host-established response whose status conflicts with the Rivet terminal is rejected;
- sign-out cookies survive terminal adaptation;
- byte file;
- stream file;
- physical file;
- filename/content disposition;
- malformed entity tag rejection at terminal construction;
- last-modified and ETag;
- range disabled gives normal success;
- satisfiable range gives 206 and correct range headers/body;
- unsatisfiable range gives host-correct 416 behavior;
- non-seekable range behavior is explicit and tested.

### Coverage tests

- direct success/error/file in MVC;
- direct success/error/file in Minimal APIs;
- direct and bound terminals in Azure Functions `[HttpTrigger]` methods;
- bound local success/error/file;
- direct `Bind(...).Success(...)` chain;
- expression-bodied route;
- route and method mismatch;
- missing implementation;
- bound but no terminal;
- multiple implementations;
- non-contract lookalike methods;
- unrelated contract terminal in the wrong route;
- composite input binding;
- deterministic diagnostics and source locations;
- Azure Functions route and method mismatch diagnostics.

### Consumer regression tests

- Casebridge controller and integration suites;
- SpeechScribe controller/integration suites, especially every former typed-result branch;
- Lagon endpoint suites, multipart upload, and file download;
- Rivet samples compile and run;
- rivet-ts scaffold lifecycle remains zero-plumb.

## Documentation Plan

Update at least:

### Rivet

- `README.md`
- `docs/reference/endpoint-builder.md`
- `docs/guides/contracts.md`
- `docs/guides/runtime-validation.md`
- `docs/guides/file-uploads.md`
- `docs/guides/error-handling.md`
- `docs/guides/contract-coverage.md`
- `docs/guides/tutorial.md`
- `docs/misc/how-it-works.md`
- `docs/misc/limitations.md`
- `samples/ContractApi/README.md`
- all MVC and Minimal sample endpoints

### rivet-ts

- `marketing.md`
- `docs/guides/dotnet-handoff.md`
- any scaffold templates, golden outputs, and lifecycle assertions that mention .NET endpoint execution

Documentation must explain four distinct stages:

1. Contract declaration.
2. Input binding where applicable.
3. Ordinary application execution.
4. Contract-owned terminal response and host adaptation.

It must state honestly that response-header declarations remain spec promises whose dynamic values are supplied by host code.

## Verification Gates

Run gates after each implementation phase, then run all gates before completion.

### Rivet repository

```bash
dotnet format --verify-no-changes
dotnet build
dotnet test
pnpm lint
pnpm fmt:check
```

Also run the strict corpus matrix and preserve its no-skip behavior. The `Invoke` replacement must not alter contract import/emission semantics or hide existing corpus failures.

Repository searches must show:

```text
0 public Invoke overloads in Rivet route definitions
0 InvokeTypedResult helpers
0 TypedResultValidator references
0 SkipValidation references
0 native Results<T1, ...> endpoint examples
0 intentional contract .Invoke(...) call sites
```

Reflection-based `ConstructorInfo.Invoke` and unrelated APIs named `Invoke` are outside this gate.

The zero-use assertion must run from the classified inventory created in Phase 0 rather than a raw text count. The broad count intentionally includes generic `.Invoke<...>` syntax and same-named unrelated methods; every classified Rivet runtime call and deliberate old-API fixture must reach zero.

### rivet-ts repository

```bash
pnpm lint
pnpm check
pnpm test
```

The scaffold lifecycle suite must retain zero Meridian plumb findings when the plumb executable is available.

### Consumer repositories

Infer and run each repository's checked-in build, formatting, static-analysis, unit, and integration commands from its project configuration. Do not invent commands. At minimum, every migrated application must compile and every endpoint-focused suite must pass.

### GitNexus/change review

- Run impact analysis before modifying the shared route-definition symbols.
- Run change detection before each repository commit.
- Review every affected execution flow, especially file delivery and explicit error switches.

## Definition of Done

The replacement is complete only when all of the following are true:

- The public API contains the agreed `Bind`, `Success`, `Error`, dedicated `File`, `ToActionResult`, and `ToResult` surface and no alternative execution API.
- Every input-bearing route shape requires `Bind(input)` before a terminal result.
- Application/use-case execution is ordinary C# outside Rivet in every example and consumer.
- All six current route-definition variants have complete success/error/file behavior appropriate to their shape.
- Every current `Invoke` overload maps to a tested replacement row in the parity matrix.
- Custom success statuses and declared errors retain or improve current enforcement.
- Exact, `nXX`, and `default` error declarations resolve deterministically at runtime.
- Operations carrying `.SuppressImplicitResponse()` cannot manufacture success but can return declared errors.
- Runtime payload honesty, body presence, and content-type checks are preserved without inspecting native framework results.
- File byte, stream, path, filename, ETag, last-modified, and range behavior is contract-owned and adapter-executed.
- Response-header behavior is documented and tested as the same explicit spec-only promise unless values are set by host code.
- Contract publication and post-publication immutability are deterministic and thread-safe.
- Roslyn coverage resolves direct and bound terminal calls semantically, does not count `Bind` alone, and validates MVC, Minimal API, and Azure Functions HTTP route contexts.
- MVC and Minimal adapters produce equivalent wire behavior.
- OIDC challenge status/headers and sign-out cookies survive adaptation without native-result passthrough.
- Samples, generated examples, documentation, scaffolding, and known consumers use only the new model.
- One explicitly versioned breaking `Rivet.Attributes` package containing only the new model is used by every migrated consumer; wildcard restore behavior is not part of verification.
- Every `Invoke` overload is deleted.
- `TypedResultValidator`, typed-result union overloads, native-result unwrapping, and `.SkipValidation()` are deleted.
- No compatibility shim, attribute shortcut, raw framework-result passthrough, or second result model remains.
- Rivet, rivet-ts, and consumer verification gates pass, with pre-existing strict corpus failures reported honestly rather than baselined or skipped.

## Explicitly Out of Scope

- Preserving source or binary compatibility with `Invoke`.
- Shipping or maintaining both old and new execution models as supported package surfaces.
- Introducing endpoint implementation attributes.
- Passing native `IResult`, `IActionResult`, `TypedResults`, or `Results<T1, ...>` through Rivet.
- Introducing generic response-union lists.
- Adding callbacks under a different method name.
- Adding a media-type, header, authentication, or framework-result escape hatch.
- Changing application/domain exception policy as part of the API replacement.
- Redesigning contract DTOs merely because existing endpoints capture some route or framework values outside them.
