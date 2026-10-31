# ShipGoods Pickup Assistant (Sarvam voice agent)

A portable copy of the Sarvam agent that makes the pre-pickup call, so it can be
recreated in any Sarvam workspace.

- `prompt.md`: the agent's instructions (single state).
- `agent.json`: voice, speech, VAD, language, greeting, nudges, variables,
  evaluation, and the 8 webhook tools with their spoken templates.

No secrets or account ids are stored here. Fill in two placeholders when
recreating it:

| Placeholder | Value |
|---|---|
| `${API_BASE_URL}` | Public URL of the ShipGoods API, e.g. `https://shipgoods-api.onrender.com` |
| `${SARVAM_TOOL_SECRET}` | The same value as `SARVAM_TOOL_SECRET` on that server |

## Recreating it in a new workspace

1. Create an agent named "ShipGoods Pickup Assistant" (single-prompt template).
2. Apply `config` from `agent.json`. Look up the voice with `list_voices`:
   "Ritu - Conversational Voice", voice_id `Shivani_Shekhar_Deshmukh-Hindi_Conversation`, and use its `internal_id`.
3. Set the prompt to `prompt.md`.
4. Create the 8 tools from `tools` (with `tool_defaults`), then enable them along
   with the core tools listed in `core_tools`.
5. Commit the draft, then on the server set `SARVAM_ORG_ID`,
   `SARVAM_WORKSPACE_ID`, `SARVAM_APP_ID` (the new agent id),
   `SARVAM_APP_VERSION`, `SARVAM_CONNECTION_ID`, `SARVAM_AGENT_PHONE_NUMBER` and
   `SARVAM_API_KEY` for the new workspace.

Verify the numbers you want to test with (OTP) in the new workspace before
placing test calls.
