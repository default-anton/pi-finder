import assert from "node:assert/strict";
import test from "node:test";

import type { AuthSource } from "pi-subagent-model-selection";
import { getSmallModelFromProvider } from "pi-subagent-model-selection";

type Model = { provider: string; id: string };

type RegistryOptions = {
  authSource?: AuthSource;
  usingOAuth?: boolean;
};

function makeRegistry(models: Model[], options: RegistryOptions = {}) {
  return {
    getAvailable() {
      return models;
    },
    getAuthSource() {
      return options.authSource ?? "none";
    },
    isUsingOAuth() {
      return options.usingOAuth ?? false;
    },
  };
}

test("oauth mode selects antigravity gemini flash", () => {
  const selected = getSmallModelFromProvider(
    makeRegistry([{ provider: "google-antigravity", id: "gemini-3-flash" }], { authSource: "oauth", usingOAuth: true }),
    { provider: "openai", id: "gpt-5.1-codex" },
  );

  assert.ok(selected);
  assert.equal(selected.model.provider, "google-antigravity");
  assert.equal(selected.authMode, "oauth");
  assert.equal(selected.authSource, "oauth");
});

test("api-key mode prefers vertex gemini flash", () => {
  const selected = getSmallModelFromProvider(
    makeRegistry(
      [
        { provider: "google-vertex", id: "gemini-3-flash-preview" },
        { provider: "google", id: "gemini-3-flash" },
      ],
      { authSource: "api_key" },
    ),
    { provider: "anthropic", id: "claude-opus-4-6" },
  );

  assert.ok(selected);
  assert.equal(selected.model.provider, "google-vertex");
  assert.equal(selected.authMode, "api-key");
  assert.equal(selected.authSource, "api_key");
});

test("falls back to current model if no preferred small models exist", () => {
  const selected = getSmallModelFromProvider(
    makeRegistry([{ provider: "openai", id: "gpt-5.1-codex" }], { authSource: "runtime" }),
    { provider: "openai", id: "gpt-5.1-codex" },
  );

  assert.ok(selected);
  assert.equal(selected.model.provider, "openai");
  assert.equal(selected.model.id, "gpt-5.1-codex");
  assert.equal(selected.thinkingLevel, "low");
});
