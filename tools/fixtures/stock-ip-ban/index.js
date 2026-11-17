"use strict";

const { LogError, LogInfo } = require("core/logger");
const { ExecuteServerCommand } = require("engines/server");
const { GetModule } = require("internal/runtime");
const { RegisterServerActivateListener } = require("listeners");
const { Connect, Receive } = require("socket");

const { GetMonotonicTimeSeconds } = GetModule("listeners/tick");

const g_strTestAddress = "127.0.0.2";
const g_unTestDurationMinutes = 1;
const g_unExpiryWaitSeconds = 85;
const g_strClockAddress = "127.0.0.1";
const g_unClockPort = 27352;
const g_unClockConnectTimeoutMilliseconds = 1_000;
const g_unClockPollTimeoutMilliseconds = 500;
const g_unClockPollByteCount = 1;
let g_bStarted = false;

function RequireServerCommand(strCommand) {
	if (!ExecuteServerCommand(strCommand)) {
		throw new Error(`The server did not dispatch ${strCommand}.`);
	}
}

function CheckExpiry() {
	RequireServerCommand("sv_cheats 1");
	RequireServerCommand("sjs_cvar sb_all_bot_game 1");
	RequireServerCommand("sjs_cvar allow_all_bot_survivor_team 1");
	RequireServerCommand("sjs_cvar sv_hibernate_when_empty 0");
	RequireServerCommand("sb_add");

	RequireServerCommand(`sjs_banip ${g_strTestAddress} ${g_unTestDurationMinutes}`);
	LogInfo("IP ban expiry fixture: before deadline.");
	RequireServerCommand("listip");

	const flDeadline = GetMonotonicTimeSeconds() + g_unExpiryWaitSeconds;

	Connect(g_strClockAddress, g_unClockPort, { Timeout: g_unClockConnectTimeoutMilliseconds }, (ConnectionError, nSocketConnectionHandle) => {
		if (ConnectionError !== null) {
			LogError("IP ban expiry fixture: loopback test clock unavailable.");
			RequireServerCommand("quit");
			return;
		}

		function Poll() {
			Receive(nSocketConnectionHandle, g_unClockPollByteCount, { Timeout: g_unClockPollTimeoutMilliseconds }, (ReceiveError, vecBytes) => {
				if ((ReceiveError === null) && (vecBytes.length === 0)) {
					LogError("IP ban expiry fixture: loopback test clock closed early.");
					RequireServerCommand("quit");
					return;
				}

				if (GetMonotonicTimeSeconds() < flDeadline) {
					Poll();
					return;
				}

				LogInfo("IP ban expiry fixture: after deadline.");
				RequireServerCommand("listip");
				LogInfo("IP ban expiry fixture: finished.");
				RequireServerCommand("quit");
			});
		}

		Poll();
	});
}

RegisterServerActivateListener(() => {
	if (!g_bStarted) {
		g_bStarted = true;
		CheckExpiry();
	}
});
