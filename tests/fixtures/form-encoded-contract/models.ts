export interface SubmitFormRequest {
  name: string;
  email: string;
  message: string;
}

export const submitFormRequestExample = {
  name: "Jane Doe",
  email: "jane@example.com",
  message: "Hello, world!",
} satisfies SubmitFormRequest;
