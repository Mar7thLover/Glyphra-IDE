import { Loader2, Pencil, Plus, Server, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type {
  McpServerRecord,
  McpTransport,
} from "@/lib/ipc/ipc";
import { useMcpStore } from "@/lib/stores/mcpStore";

import {
  SettingsField,
  SettingsInput,
  SettingsSelect,
  ToggleRow,
} from "./SettingsField";

function endpointLabel(server: McpServerRecord) {
  return server.transport === "stdio"
    ? [server.command, ...server.args].filter(Boolean).join(" ")
    : server.url ?? "";
}

export default function McpSection() {
  const { t } = useTranslation();
  const servers = useMcpStore((state) => state.servers);
  const loading = useMcpStore((state) => state.loading);
  const saving = useMcpStore((state) => state.saving);
  const error = useMcpStore((state) => state.error);
  const refresh = useMcpStore((state) => state.refresh);
  const upsert = useMcpStore((state) => state.upsert);
  const remove = useMcpStore((state) => state.remove);
  const setEnabled = useMcpStore((state) => state.setEnabled);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<McpTransport>("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("[]");
  const [url, setUrl] = useState("");
  const [enabled, setFormEnabled] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const reset = () => {
    setEditingId(null);
    setName("");
    setTransport("stdio");
    setCommand("");
    setArgs("[]");
    setUrl("");
    setFormEnabled(true);
    setFormError(null);
  };

  const edit = (server: McpServerRecord) => {
    setEditingId(server.id);
    setName(server.name);
    setTransport(server.transport);
    setCommand(server.command ?? "");
    setArgs(JSON.stringify(server.args));
    setUrl(server.url ?? "");
    setFormEnabled(server.enabled);
    setFormError(null);
  };

  const save = async () => {
    setFormError(null);
    let parsedArgs: unknown = [];
    if (transport === "stdio") {
      try {
        parsedArgs = JSON.parse(args);
      } catch {
        setFormError(t("settings.mcpArgsInvalid"));
        return;
      }
      if (
        !Array.isArray(parsedArgs)
        || !parsedArgs.every((value) => typeof value === "string")
      ) {
        setFormError(t("settings.mcpArgsInvalid"));
        return;
      }
    }
    const record = await upsert({
      id: editingId,
      name,
      transport,
      command: transport === "stdio" ? command : null,
      args: parsedArgs as string[],
      url: transport === "stdio" ? null : url,
      enabled,
    });
    if (record) reset();
  };

  return (
    <div className="space-y-4">
      <p className="text-[11px] leading-relaxed text-ink-3">
        {t("settings.mcpHint")}
      </p>

      <div className="space-y-2.5 rounded-lg border border-line p-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[10px] uppercase tracking-[0.06em] text-ink-3">
            {editingId ? t("settings.mcpEdit") : t("settings.mcpAdd")}
          </div>
          {editingId && (
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-3 hover:bg-hover hover:text-ink"
            >
              <X className="size-3" />
              {t("settings.mcpCancelEdit")}
            </button>
          )}
        </div>
        <SettingsField label={t("settings.mcpName")}>
          <SettingsInput
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Filesystem"
          />
        </SettingsField>
        <SettingsField label={t("settings.mcpTransport")}>
          <SettingsSelect
            value={transport}
            onChange={(value) => setTransport(value as McpTransport)}
          >
            <option value="stdio">stdio</option>
            <option value="http">HTTP</option>
            <option value="sse">SSE</option>
          </SettingsSelect>
        </SettingsField>
        {transport === "stdio" ? (
          <>
            <SettingsField label={t("settings.mcpCommand")}>
              <SettingsInput
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                placeholder="npx"
              />
            </SettingsField>
            <SettingsField
              label={t("settings.mcpArgs")}
              hint={t("settings.mcpArgsHint")}
            >
              <SettingsInput
                value={args}
                onChange={(event) => setArgs(event.target.value)}
                placeholder={'["-y", "@modelcontextprotocol/server-filesystem"]'}
              />
            </SettingsField>
          </>
        ) : (
          <SettingsField label={t("settings.mcpUrl")}>
            <SettingsInput
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/mcp"
            />
          </SettingsField>
        )}
        <ToggleRow
          label={t("settings.mcpEnabled")}
          hint={t("settings.mcpEnabledHint")}
          checked={enabled}
          onChange={setFormEnabled}
        />
        {formError && <p className="text-[11px] text-danger">{formError}</p>}
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="inline-flex h-7 w-full items-center justify-center gap-1 rounded-md bg-ink text-[11px] text-[var(--bg-raised)] disabled:opacity-50"
        >
          {saving ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
          {editingId ? t("settings.mcpSaveChanges") : t("settings.mcpSave")}
        </button>
      </div>

      {error && <p className="text-[11px] text-danger">{error}</p>}
      {loading && (
        <div className="flex items-center gap-1 text-[11px] text-ink-3">
          <Loader2 className="size-3 animate-spin" />
          {t("settings.loading")}
        </div>
      )}

      <div>
        <div className="mb-1.5 text-[10px] uppercase tracking-[0.06em] text-ink-3">
          {t("settings.mcpSaved")}
        </div>
        <div className="space-y-1.5">
          {servers.map((server) => (
            <div
              key={server.id}
              className="rounded-lg border border-line px-2.5 py-2 text-[11px]"
            >
              <div className="flex items-center gap-2">
                <Server className="size-3.5 shrink-0 text-ink-3" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-ink-2">{server.name}</div>
                  <div
                    className="truncate text-[10px] text-ink-3"
                    title={endpointLabel(server)}
                  >
                    {server.transport} · {endpointLabel(server)}
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={server.enabled}
                  title={server.enabled ? t("settings.mcpDisable") : t("settings.mcpEnable")}
                  disabled={saving}
                  onClick={() => void setEnabled(server.id, !server.enabled)}
                  className={`inline-flex h-4 w-7 shrink-0 items-center rounded-full border transition-colors ${
                    server.enabled ? "border-ink bg-ink" : "border-line bg-raised"
                  }`}
                >
                  <span
                    className={`size-3 rounded-full bg-[var(--bg-raised)] transition-transform ${
                      server.enabled ? "translate-x-3.5" : "translate-x-0.5"
                    }`}
                  />
                </button>
                <button
                  type="button"
                  title={t("settings.mcpEdit")}
                  onClick={() => edit(server)}
                  className="rounded border border-line p-1 text-ink-3 hover:bg-hover hover:text-ink"
                >
                  <Pencil className="size-3" />
                </button>
                <button
                  type="button"
                  title={t("settings.mcpRemove")}
                  onClick={() => {
                    if (window.confirm(t("settings.mcpRemoveConfirm", { name: server.name }))) {
                      void remove(server.id);
                      if (editingId === server.id) reset();
                    }
                  }}
                  className="rounded border border-line p-1 text-ink-3 hover:bg-hover hover:text-danger"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            </div>
          ))}
          {!loading && servers.length === 0 && (
            <div className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-[11px] text-ink-3">
              {t("settings.mcpEmpty")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
