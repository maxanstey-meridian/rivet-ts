import type { Contract, Endpoint } from "../dist/index.js";

export interface TodoDto {
  id: string;
  title: string;
  done: boolean;
}

export interface ListTodosResponse {
  items: TodoDto[];
  totalCount: number;
}

export interface GetTodoParams {
  id: string;
}

export interface CreateTodoRequest {
  title: string;
}

export interface ToggleTodoRequest {
  id: string;
}

export interface NotFoundDto {
  message: string;
}

export interface TodoContract extends Contract<"TodoContract"> {
  ListTodos: Endpoint<{
    method: "GET";
    route: "/todos";
    response: ListTodosResponse;
  }>;

  GetTodo: Endpoint<{
    method: "GET";
    route: "/todos/{id}";
    params: GetTodoParams;
    response: TodoDto;
    errors: [{ status: 404; response: NotFoundDto; description: "Todo not found" }];
  }>;

  CreateTodo: Endpoint<{
    method: "POST";
    route: "/todos";
    input: CreateTodoRequest;
    response: TodoDto;
    successStatus: 201;
  }>;

  ToggleTodo: Endpoint<{
    method: "POST";
    route: "/todos/toggle";
    input: ToggleTodoRequest;
    response: TodoDto;
    errors: [{ status: 404; response: NotFoundDto; description: "Todo not found" }];
  }>;
}
