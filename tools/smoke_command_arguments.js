"use strict";

const g_Assert = require("node:assert/strict");

// Install the existing command-runtime fixture before loading the public wrapper.
require("./smoke_commands_auth_player.js");

const { Command, MAX_COMMAND_LENGTH } = require("../packages/sourcejs/commands.js");

function CreateCommandWithArguments(vecArguments) {
	return new Command({ Arguments: vecArguments, Raw: "test", Name: "test", Kind: "server", Index: 0 });
}

for (const vecArguments of [new Array(1), ["test", , "last"], [undefined], [null], [42]]) {
	g_Assert.throws(() => CreateCommandWithArguments(vecArguments), TypeError);
}

for (const vecArguments of [[], [""], ["test", "value"]]) {
	const CommandValue = CreateCommandWithArguments(vecArguments);
	g_Assert.deepEqual(CommandValue.Arguments, vecArguments);

	vecArguments.push("changed");
	g_Assert.notDeepEqual(CommandValue.Arguments, vecArguments);

	const vecReturnedArguments = CommandValue.Arguments;
	vecReturnedArguments.push("modified copy");
	g_Assert.notDeepEqual(CommandValue.Arguments, vecReturnedArguments);
	g_Assert.deepEqual(Array.from(CommandValue), CommandValue.Arguments);
}

const g_CommandLimitDescriptor = Object.getOwnPropertyDescriptor(Command, "MAX_COMMAND_LENGTH");
g_Assert.deepEqual(g_CommandLimitDescriptor, { configurable: true, enumerable: true, value: MAX_COMMAND_LENGTH, writable: true });

for (const nIndex of [-1, 0, 17]) {
	const CommandValue = new Command({ Arguments: ["test", "value"], Raw: "test value", Name: "test", Kind: "server", Index: nIndex });
	g_Assert.equal(CommandValue.Index, nIndex, "source index preserves the signed integer payload contract");
	g_Assert.equal(CommandValue.GetArgument(-1), undefined);
	g_Assert.equal(CommandValue.GetArgument(0), "test");
	g_Assert.equal(CommandValue.GetArgument(1), "value");
	g_Assert.equal(CommandValue.GetArgument(2), undefined);

	for (const InvalidIndex of [NaN, 0.5, "0", null, {}]) {
		g_Assert.throws(() => CommandValue.GetArgument(InvalidIndex), TypeError);
	}
}

console.log("[smoke_command_arguments] ok");
