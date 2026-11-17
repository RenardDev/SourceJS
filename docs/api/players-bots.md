# `require("players/bots")`

The `players/bots` module exposes the selected SDK's native player factory and its human/bot partitions. It is a direct view over `IPlayerInfoManager` with no JavaScript roster cache or fallback player.

The CommonJS entry point lives in [`packages/sourcejs/players/bots.js`](../../packages/sourcejs/players/bots.js) and returns the exact native `players/bots` module object. Use [`players`](players.md) when returned native wrappers need the shared SourceJS decorator and higher-level operations.

## Contents

- [Import](#import)
- [API](#api)
- [Split the current roster](#split-the-current-roster)
- [Operate on human clients only](#operate-on-human-clients-only)
- [Resolve a listed player again](#resolve-a-listed-player-again)
- [Errors](#errors)
- [Lifecycle](#lifecycle)
- [Related modules](#related-modules)

## Import

```js
const { GetBotPlayers, GetHumanPlayers, GetPlayer } = require("players/bots");

if ([GetBotPlayers, GetHumanPlayers, GetPlayer].some((Callback) => typeof Callback !== "function")) {
	throw new Error("players/bots does not expose its complete native API.");
}
```

## API

| Export | Result | Purpose |
| --- | --- | --- |
| `GetHumanPlayers()` | native player array | Enumerate currently connected non-fake clients. |
| `GetBotPlayers()` | native player array | Enumerate currently connected fake clients. |
| `GetPlayer(nEntityIndex)` | native player or `null` | Resolve one current player by one-based entity index. |

Each enumeration creates an array of current connected clients, filtered by the SDK's `IsFakeClient()` result. Calls are
separate observations, not an atomic roster snapshot. `GetPlayer()` resolves an existing player-info record and does not
itself require that client to be connected.

The wrappers borrow native state. `Index` names a one-based slot; live properties such as `UserID`, `Name`, `Connected`, and
`FakeClient` query that slot again. Keeping a wrapper is not keeping its connection alive: after reuse, its live getters can
observe another occupant. Copy an index and numeric user ID before deferring work, then re-resolve and compare both before
acting. A matching pair is only a short-lived check within the same server session, not an ownership or lifetime proof.

## Split the current roster

Run both enumerations and consume their live getters on the game thread without yielding; the overlap check is a diagnostic,
not a guarantee of stable membership or atomicity across calls. The resulting name arrays are ordinary string snapshots.

```js
const { GetBotPlayers, GetHumanPlayers } = require("players/bots");
const { GetName, IsConnected } = require("players");

const g_vecHumanPlayers = GetHumanPlayers();
const g_vecBotPlayers = GetBotPlayers();
const g_setHumanIndexes = new Set(g_vecHumanPlayers.map((CandidatePlayer) => CandidatePlayer.Index));
if (g_vecBotPlayers.some((CandidatePlayer) => g_setHumanIndexes.has(CandidatePlayer.Index))) {
	throw new Error("The native human and bot partitions overlap.");
}

const g_Roster = {
	Bots: g_vecBotPlayers.map((CandidatePlayer) => GetName(CandidatePlayer)),
	ConnectedHumans: g_vecHumanPlayers.filter((CandidatePlayer) => IsConnected(CandidatePlayer)).map((CandidatePlayer) => GetName(CandidatePlayer)),
};
if ([...g_Roster.Bots, ...g_Roster.ConnectedHumans].some((strName) => typeof strName !== "string")) {
	throw new Error("The current player partitions contain an invalid name.");
}
```

## Operate on human clients only

Native player wrappers include the canonical player methods. On a controlled test server, this example submits a fixed
client-console `echo` command only to connected humans. `ExecuteClientCommand(strCommand, bServerSide = false)` uses the
plugin-helper dispatch path when available, with an engine fallback; `true` selects engine dispatch directly. A successful
boolean reports submission, not client acknowledgement, command completion, or a transaction across the entire roster.
Earlier submissions cannot be undone if a later client fails:

```js
const { GetHumanPlayers } = require("players/bots");
const { IsConnected } = require("players");

for (const HumanPlayer of GetHumanPlayers()) {
	if (!IsConnected(HumanPlayer)) {
		continue;
	}

	if ((typeof HumanPlayer.ExecuteClientCommand !== "function") || !HumanPlayer.ExecuteClientCommand("echo SourceJS human client", false)) {
		throw new Error(`The command could not be sent to human player ${HumanPlayer.Index}.`);
	}
}
```

## Resolve a listed player again

Use `GetPlayer(nEntityIndex)` for a short-lived selection or a native callback. Copy the selected numeric identity before
any defer/await/frame boundary. A freed slot can resolve to `null`; a still-present player-info record can be disconnected,
and the same index can now belong to a different user. All three cases are skipped below. Never compare against a fresh
`UserID` read from the old wrapper, which can already expose the replacement client's ID:

```js
const { GetBotPlayers, GetHumanPlayers, GetPlayer } = require("players/bots");
const { GetName, IsConnected } = require("players");

const g_ListedPlayer = [...GetHumanPlayers(), ...GetBotPlayers()][0];
if (g_ListedPlayer) {
	const Selection = { Index: g_ListedPlayer.Index, UserID: g_ListedPlayer.UserID };
	if (!Number.isInteger(Selection.Index) || (Selection.Index <= 0) || !Number.isInteger(Selection.UserID) || (Selection.UserID < 0)) {
		throw new Error("The selected player has an invalid numeric identity.");
	}

	const CurrentPlayer = GetPlayer(Selection.Index);
	if ((CurrentPlayer !== null) && IsConnected(CurrentPlayer) && (CurrentPlayer.UserID === Selection.UserID)) {
		const ResolvedPlayer = {
			Index: CurrentPlayer.Index,
			Name: GetName(CurrentPlayer),
			UserID: CurrentPlayer.UserID,
		};
		if ((ResolvedPlayer.Index !== Selection.Index) || (ResolvedPlayer.UserID !== Selection.UserID) || (typeof ResolvedPlayer.Name !== "string")) {
			throw new Error("The re-resolved player does not match the saved identity.");
		}
	}
}
```

## Errors

- Loading fails when SourceJS did not install the native `players/bots` module for the selected SDK.
- Calling `GetPlayer()` without an argument throws. Index resolution accepts the native integer/index-backed representations;
  a nonpositive, unresolved or currently freed slot normally returns `null`. This is not a strict JavaScript-number validator.
- Lookups/enumerations require the live player-info manager and server globals; unavailable engine services are errors, not
  fabricated empty/fallback players.
- Command errors propagate; the example stops at the first failing submission and does not reverse earlier submissions.
- Retained wrappers can observe a replacement occupant through live slot properties. Neither enumeration, identity comparison
  nor re-resolution keeps a native client alive or validates stale memory.

## Lifecycle

- Player indexes are one-based entity indexes, not zero-based `IServer` client slots.
- Resolve wrappers again after disconnects and map changes. Do not carry old numeric selections across a server-session reset.
- Keep these synchronous native queries/commands on the game thread. Do not retain borrowed wrappers across asynchronous work;
  save primitive identity values first and re-resolve them when returning to the game thread.
- Use `GetHumanPlayers()` rather than testing names or Steam IDs to exclude fake clients.
- Use `GetBotPlayers()` for the SDK fake-client partition; HLTV behavior follows the selected SDK's `IPlayerInfo::IsFakeClient()` result.
- Returned arrays are ordinary JavaScript arrays; modifying them does not change native membership. Retaining or mutating them
  does not create a live roster cache. A string snapshot can also become stale.

## Related modules

- [`players`](players.md) decorates native wrappers and provides identity, command, moderation and gameplay operations.
- [`players/entity`](players-entity.md) documents the decorated instance-method surface.
- [`players/dictionary`](players-dictionary.md) provides keyed access to current decorated players.
- [`engines/server`](engines-server.md) uses zero-based client slots when an internal `IClient` wrapper is required.
