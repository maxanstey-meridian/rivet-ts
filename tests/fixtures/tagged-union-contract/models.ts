export interface WorkspaceKeyContract {
  appName: string;
  windowTitle: string;
}

export interface SummaryContract {
  project: string;
  task: string;
}

export type DisplayStateContract =
  | {
      kind: "hidden";
      workspaceKey: WorkspaceKeyContract | null;
    }
  | {
      kind: "loading";
      requestId: string;
      workspaceKey: WorkspaceKeyContract;
    }
  | {
      kind: "shown";
      summary: SummaryContract;
      workspaceKey: WorkspaceKeyContract;
    }
  | {
      kind: "error";
      message: string;
      requestId: string;
      workspaceKey: WorkspaceKeyContract;
    };

export interface RefreshDisplayRequest {
  workspaceKey: WorkspaceKeyContract;
}
