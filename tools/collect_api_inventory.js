"use strict";

const { GetCoreModules, GetGlobalInfo, GetPublicPackages } = require("core");
const { WriteTextFile } = require("filesystem");
const { LogInfo } = require("loggers");
const { PLUGIN_DATA_ROOT } = require("paths");

const g_vecAdditionalModules = /* Additional module paths */ [];
const g_unMaximumNamespaceDepth = 2;
const g_setFunctionInternals = new Set(["arguments", "caller", "length", "name", "prototype"]);
const g_strInventoryPath = `${PLUGIN_DATA_ROOT}/api-documentation/Inventory.json`;

function CollectMembers(Module, strPrefix, unDepth, setNames, setAncestors) {
	if (((typeof Module !== "object") && (typeof Module !== "function")) || (Module === null) || setAncestors.has(Module) || (unDepth > g_unMaximumNamespaceDepth)) {
		return;
	}

	setAncestors.add(Module);
	for (const [strName, Descriptor] of Object.entries(Object.getOwnPropertyDescriptors(Module))) {
		if (strName.startsWith("_") || ((typeof Module === "function") && g_setFunctionInternals.has(strName))) {
			continue;
		}

		const strQualifiedName = strPrefix ? `${strPrefix}.${strName}` : strName;
		setNames.add(strQualifiedName);

		const Value = Descriptor.value;
		if (typeof Value === "function") {
			const Prototype = Object.getOwnPropertyDescriptor(Value, "prototype")?.value;
			if (Prototype) {
				for (const strMember of Object.getOwnPropertyNames(Prototype)) {
					if ((strMember !== "constructor") && !strMember.startsWith("_")) {
						setNames.add(`${strQualifiedName}.${strMember}`);
					}
				}
			}

			CollectMembers(Value, strQualifiedName, unDepth + 1, setNames, setAncestors);
		} else if ((unDepth < g_unMaximumNamespaceDepth) && (Value !== null) && (typeof Value === "object")) {
			const Prototype = Object.getPrototypeOf(Value);
			if ((Prototype === Object.prototype) || (Prototype === null)) {
				CollectMembers(Value, strQualifiedName, unDepth + 1, setNames, setAncestors);
			}
		}
	}

	setAncestors.delete(Module);
}

function WriteInventory() {
	const setModuleNames = new Set([...GetPublicPackages(), ...GetCoreModules(), ...g_vecAdditionalModules]);
	const Modules = Object.create(null);
	const Errors = Object.create(null);
	for (const strModule of [...setModuleNames].sort()) {
		if ((typeof strModule !== "string") || !/^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(strModule) || (strModule === "internal") || strModule.startsWith("internal/")) {
			continue;
		}

		try {
			// Reflect the installed surface without invoking API accessors or constructors.
			const Module = require(strModule);
			const setNames = new Set();
			CollectMembers(Module, "", 0, setNames, new Set());
			Modules[strModule] = [...setNames].sort();
		} catch (Failure) {
			Errors[strModule] = Failure?.message ?? String(Failure);
		}
	}

	const Inventory = { Version: 1, Runtime: GetGlobalInfo(), Modules, Errors };
	if (!WriteTextFile(g_strInventoryPath, `${JSON.stringify(Inventory, null, "\t")}\n`)) {
		throw new Error(`Could not write the API inventory: ${g_strInventoryPath}`);
	}

	LogInfo(`Wrote API inventory to ${g_strInventoryPath}`);
}

WriteInventory();
