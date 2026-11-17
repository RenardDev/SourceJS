"use strict";

const g_Assert = require("node:assert/strict");
const { CommandRegistration, RegisterCommand } = require("../packages/sourcejs/commands/command.js");

function VerifyRegistrationRollback(strRegistrationFailure, strCleanupFailure) {
	const setNames = new Set();
	const RegistrationError = new Error("Registration failed.");
	const CleanupError = new Error("Cleanup failed.");
	let bFailCleanup = strCleanupFailure !== "NONE";
	const Callback = () => {
	};
	const Runtime = {
		Register(strName, RegisteredCallback) {
			g_Assert.equal(RegisteredCallback, Callback);

			if (strName === "second") {
				if (strRegistrationFailure === "THROW") {
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
				if (strCleanupFailure === "THROW") {
					throw CleanupError;
				}

				return false;
			}

			return setNames.delete(strName);
		},
	};
	const Registration = new CommandRegistration(Runtime, ["first", "second"], Callback);
	const VerifyFailure = (Failure) => {
		if (bFailCleanup) {
			g_Assert.ok(Failure instanceof AggregateError);
			g_Assert.equal(Failure.errors.length, 2);

			if (strRegistrationFailure === "THROW") {
				g_Assert.equal(Failure.errors[0], RegistrationError);
			}

			if (strCleanupFailure === "THROW") {
				g_Assert.equal(Failure.errors[1], CleanupError);
			}

			return true;
		}

		return (strRegistrationFailure === "FALSE") || (Failure === RegistrationError);
	};
	g_Assert.throws(() => Registration.Load(), VerifyFailure);
	g_Assert.equal(Registration.Loaded, bFailCleanup);
	g_Assert.equal(setNames.size, bFailCleanup ? 1 : 0);

	if (bFailCleanup) {
		g_Assert.throws(() => Registration.Load());
		bFailCleanup = false;
		g_Assert.equal(Registration.Unload(), true);
	}

	g_Assert.equal(Registration.Unload(), false);
	g_Assert.equal(setNames.size, 0);
}

function VerifyCommandNameNormalization() {
	const vecCalls = [];
	const Callback = () => {
	};
	const Runtime = {
		Register(strName, RegisteredCallback) {
			g_Assert.equal(RegisteredCallback, Callback);
			vecCalls.push(strName);

			return true;
		},
		Unregister() {
			return true;
		},
	};
	let unScenarios = 0;
	const Reject = (Names) => {
		const unBefore = vecCalls.length;
		g_Assert.throws(() => RegisterCommand(Runtime, Names, Callback), TypeError);
		g_Assert.equal(vecCalls.length, unBefore, "Invalid names must be rejected before registration.");
		unScenarios++;
	};
	for (let unLength = 1; unLength <= 5; ++unLength) {
		for (let unHole = 0; unHole < unLength; ++unHole) {
			for (const bInherited of [false, true]) {
				const vecNames = Array.from(new Array(unLength).keys(), (unIndex) => `name${unIndex}`);
				delete vecNames[unHole];

				if (bInherited) {
					const Prototype = Object.create(Array.prototype);
					Object.defineProperty(Prototype, unHole, { value: "inherited", configurable: true });
					Object.setPrototypeOf(vecNames, Prototype);
				}

				Reject(vecNames);
			}
		}
	}

	for (const InvalidName of [undefined, null, false, 1, 1n, {}, () => {}, Symbol("name"), "", " \t\r\n"]) {
		Reject(InvalidName);
		Reject(["known", InvalidName]);
	}

	Reject([]);
	Reject(["same", " same "]);
	g_Assert.throws(() => RegisterCommand(Runtime, ["same", "same", null], Callback), /non-empty strings/);
	unScenarios++;

	for (const strName of ["known", " known ", "\tknown\n"]) {
		vecCalls.length = 0;
		const Registration = RegisterCommand(Runtime, strName, Callback);
		g_Assert.deepEqual(Registration.Names, ["known"]);
		g_Assert.deepEqual(vecCalls, ["known"]);
		g_Assert.equal(Registration.Unload(), true);
		unScenarios++;
	}

	const vecCustomNames = [" first ", " second "];
	for (const strMethod of ["every", "map"]) {
		Object.defineProperty(vecCustomNames, strMethod, {
			get() {
				g_Assert.fail("Name normalization must not access source every/map methods.");
			},
		});
	}

	vecCalls.length = 0;
	const CustomRegistration = new CommandRegistration(Runtime, vecCustomNames, Callback);
	vecCustomNames[0] = "changed";
	CustomRegistration.Load();
	g_Assert.deepEqual(CustomRegistration.Names, ["first", "second"]);
	g_Assert.deepEqual(vecCalls, ["first", "second"]);
	CustomRegistration.Unload();
	unScenarios++;

	class NameArray extends Array {
		static get [Symbol.species]() {
			g_Assert.fail("Name normalization must not invoke a source species constructor.");
		}
	}

	const SpeciesRegistration = RegisterCommand(Runtime, new NameArray("first", " second "), Callback);
	g_Assert.deepEqual(SpeciesRegistration.Names, ["first", "second"]);
	SpeciesRegistration.Unload();
	unScenarios++;

	const vecGetterNames = ["unused"];
	let unReads = 0;
	Object.defineProperty(vecGetterNames, 0, {
		get() {
			return (++unReads === 1) ? " first " : 42;
		},
	});
	const GetterRegistration = RegisterCommand(Runtime, vecGetterNames, Callback);
	g_Assert.deepEqual(GetterRegistration.Names, ["first"]);
	g_Assert.equal(unReads, 1);
	GetterRegistration.Unload();
	unScenarios++;

	for (const InvalidLength of [undefined, null, -1, NaN, Infinity, 1.5, "2", 1n, Symbol("length")]) {
		Reject(new Proxy(["known"], {
			get(Target, Property, Receiver) {
				return (Property === "length") ? InvalidLength : Reflect.get(Target, Property, Receiver);
			},
		}));
	}

	for (const Failure of [undefined, null, false, 0, 0n, "", NaN, Object.create(null), new Error("name getter")]) {
		const vecNames = ["unused"];
		Object.defineProperty(vecNames, 0, {
			get() {
				throw Failure;
			},
		});
		const unBefore = vecCalls.length;
		let bCaught = false;
		try {
			RegisterCommand(Runtime, vecNames, Callback);
		} catch (Exception) {
			g_Assert(Object.is(Exception, Failure));
			bCaught = true;
		}

		g_Assert(bCaught);
		g_Assert.equal(vecCalls.length, unBefore);
		unScenarios++;
	}

	console.log(`Command names ${unScenarios} dense/sparse/snapshot/error profiles passed (actual registration helper;controlled adapter,no native IO).`);
}

VerifyCommandNameNormalization();

for (const strRegistrationFailure of ["FALSE", "THROW"]) {
	for (const strCleanupFailure of ["NONE", "FALSE", "THROW"]) {
		VerifyRegistrationRollback(strRegistrationFailure, strCleanupFailure);
	}
}

console.log("[smoke_command_registration_rollback] ok");
