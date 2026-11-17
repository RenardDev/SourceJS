"use strict";

const g_Assert = require("node:assert/strict");
const { CommandRegistrationManager } = require("../packages/sourcejs/commands/manager.js");

function VerifyManagerRollback(bThrowRegistration, bFailRollback) {
	const setNames = new Set();
	const RegistrationError = new Error("Registration failed.");
	let bFailCleanup = bFailRollback;
	const Callback = () => {
	};
	const Runtime = {
		Register(strName, RegisteredCallback) {
			g_Assert.equal(RegisteredCallback, Callback);

			if (strName === "second") {
				if (bThrowRegistration) {
					throw RegistrationError;
				}

				return false;
			}

			setNames.add(strName);

			return true;
		},
		Unregister(strName, RegisteredCallback) {
			g_Assert.equal(RegisteredCallback, Callback);

			if (bFailCleanup) {
				return false;
			}

			return setNames.delete(strName);
		},
	};
	const Manager = new CommandRegistrationManager(Runtime);
	const VerifyFailure = (Failure) => {
		if (bFailRollback) {
			g_Assert.ok(Failure instanceof AggregateError);
			g_Assert.equal(Failure.errors.length, 2);

			if (bThrowRegistration) {
				g_Assert.equal(Failure.errors[0], RegistrationError);
			}

			return true;
		}

		return !bThrowRegistration || (Failure === RegistrationError);
	};
	g_Assert.throws(() => Manager.Register(["first", "second"], Callback), VerifyFailure);
	g_Assert.equal(setNames.size, bFailRollback ? 1 : 0);

	if (bFailRollback) {
		g_Assert.throws(() => Manager.UnloadAll());
		g_Assert.equal(setNames.size, 1);
	}

	bFailCleanup = false;
	g_Assert.equal(Manager.UnloadAll(), true);
	g_Assert.equal(setNames.size, 0);
	g_Assert.equal(Manager.UnloadAll(), true);

	const Registration = Manager.Register("first", Callback);
	g_Assert.equal(Registration.Loaded, true);
	g_Assert.equal(Manager.Unregister(Registration), true);
	g_Assert.equal(setNames.size, 0);
}

for (const bThrowRegistration of [false, true]) {
	for (const bFailRollback of [false, true]) {
		VerifyManagerRollback(bThrowRegistration, bFailRollback);
	}
}

console.log("[smoke_command_manager_rollback] ok");
