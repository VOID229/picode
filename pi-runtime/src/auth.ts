import type { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { RuntimeCatalogPayload } from "./protocol";

export interface AuthUiBridge {
  emitCatalog(catalog: RuntimeCatalogPayload): void;
  emitEvent(event: {
    type:
      | "status"
      | "auth_browser_open"
      | "auth_manual_input_requested"
      | "auth_completed"
      | "auth_failed";
    [key: string]: unknown;
  }): void;
  requestInput(args: {
    providerId: string;
    title: string;
    message: string;
    placeholder?: string;
    kind: "prompt" | "manual-code";
  }): Promise<string>;
}

export async function loginOAuthProvider(args: {
  providerId: string;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  bridge: AuthUiBridge;
  refreshCatalog: () => Promise<RuntimeCatalogPayload>;
}) {
  const { providerId, authStorage, bridge, refreshCatalog } = args;
  try {
    await authStorage.login(providerId, {
      onAuth(info) {
        bridge.emitEvent({
          type: "auth_browser_open",
          providerId,
          url: info.url,
          instructions: info.instructions,
        });
      },
      onProgress(message) {
        bridge.emitEvent({
          type: "status",
          label: `${providerId} login`,
          detail: message,
        });
      },
      async onPrompt(prompt) {
        return bridge.requestInput({
          providerId,
          title: `Continue ${providerId} login`,
          message: prompt.message,
          placeholder: prompt.placeholder,
          kind: "prompt",
        });
      },
      async onManualCodeInput() {
        return bridge.requestInput({
          providerId,
          title: `Finish ${providerId} login`,
          message:
            "Paste the callback URL or the manual code from the browser.",
          kind: "manual-code",
        });
      },
    });

    const catalog = await refreshCatalog();
    bridge.emitEvent({
      type: "auth_completed",
      providerId,
    });
    bridge.emitCatalog(catalog);
    return catalog;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    bridge.emitEvent({
      type: "auth_failed",
      providerId,
      message,
    });
    throw error;
  }
}

export function saveProviderApiKey(args: {
  providerId: string;
  apiKey: string;
  authStorage: AuthStorage;
}) {
  args.authStorage.set(args.providerId, {
    type: "api_key",
    key: args.apiKey,
  });
}

export function deleteProviderApiKey(args: {
  providerId: string;
  authStorage: AuthStorage;
}) {
  args.authStorage.remove(args.providerId);
}
