export interface ChatGptConnectionSummary {
  clientId: string;
  email: string | null;
  planEnabled: boolean;
  expiresAt: number;
}
export interface ChatGptPlanDesktopApi {
  list: () => Promise<ChatGptConnectionSummary[]>;
  connect: (clientId?: string) => Promise<ChatGptConnectionSummary>;
  cancel: () => Promise<void>;
  disconnect: (clientId: string) => Promise<void>;
}
