"use strict";

const { Convention, DataType, Register } = require("memory");
const { ADDRESS_SIZE } = require("memory/helpers");
const { CallFunction } = require("memory/hooks");
const { LogInfo, LogWarning } = require("loggers");
const { RegisterCommand, UnregisterCommand } = require("source");

const g_strCommandName = "abi_call_example";
const g_strThisRegisterName = (ADDRESS_SIZE === 8) ? Register.RCX : Register.ECX;
const g_strObservedRegisterName = (ADDRESS_SIZE === 8) ? Register.RDX : Register.EDX;
const g_unMaximumAddress = (1n << BigInt(ADDRESS_SIZE * 8)) - 1n;

let g_bCleaned = false;

function CallNativeExample(unFunctionAddress, unThisObjectAddress) {
	return CallFunction({
		Address: unFunctionAddress,
		Convention: Convention.Fastcall,
		ReturnType: DataType.Int,
		ThisObject: unThisObjectAddress,
		Registers: {
			[g_strThisRegisterName]: unThisObjectAddress,
		},
		Arguments: [
			{ Type: DataType.Int, Value: 123 },
			{ Type: DataType.String, Value: "Use" },
		],
		ReturnContext: true,
	});
}

function ParseAddress(strValue) {
	try {
		const unAddress = BigInt(strValue);
		if ((unAddress <= 0n) || (unAddress > g_unMaximumAddress)) {
			return null;
		}

		return unAddress;
	} catch {
		return null;
	}
}

function RunNativeExample(Command) {
	const vecCommandArguments = Command.Arguments.slice(1);
	if ((vecCommandArguments.length !== 3) || (vecCommandArguments[2] !== "confirm")) {
		LogInfo(`Usage: ${g_strCommandName} <address> <this-address> confirm`);
		return;
	}

	const unFunctionAddress = ParseAddress(vecCommandArguments[0]);
	const unThisObjectAddress = ParseAddress(vecCommandArguments[1]);
	if ((unFunctionAddress === null) || (unThisObjectAddress === null)) {
		LogWarning("Function address and this-object address must be positive integers that fit the native address width.");
		return;
	}

	const Invocation = CallNativeExample(unFunctionAddress, unThisObjectAddress);
	if ((Invocation === null) || (typeof Invocation !== "object")) {
		LogWarning("The native ABI call did not return an execution context.");
		return;
	}

	const unObservedRegister = Invocation.Registers[g_strObservedRegisterName];
	LogInfo(`ABI call completed Return=${Invocation.ReturnValue} ${g_strObservedRegisterName}=${unObservedRegister}`);
}

function Cleanup() {
	if (g_bCleaned) {
		return;
	}

	UnregisterCommand(g_strCommandName, RunNativeExample);
	g_bCleaned = true;
}

if (!RegisterCommand(g_strCommandName, RunNativeExample)) {
	throw new Error(`Could not register ${g_strCommandName}.`);
}

LogInfo(`ABI call example loaded; run "${g_strCommandName} <address> <this-address> confirm" with a verified function ABI.`);

exports.Unload = Cleanup;
