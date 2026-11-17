"use strict";

function NormalizePath(strValue) {
	if (typeof strValue !== "string") {
		throw new TypeError("Path values must be strings.");
	}

	const strSlashNormalizedPath = strValue.replace(/\\/g, "/");
	const bHasUNCRoot = strSlashNormalizedPath.startsWith("//") && !strSlashNormalizedPath.startsWith("///");
	const strNormalizedPath = strSlashNormalizedPath.replace(/\/+/g, "/");

	return bHasUNCRoot ? ("/" + strNormalizedPath) : strNormalizedPath;
}

function JoinPath(strRoot, ...vecPathParts) {
	const strNormalizedRoot = NormalizePath(strRoot);

	for (const strPathPart of vecPathParts) {
		if ((strPathPart !== null) && (strPathPart !== undefined) && (typeof strPathPart !== "string")) {
			throw new TypeError("Path parts must be strings.");
		}
	}

	const vecNormalizedParts = vecPathParts
		.filter((strPathPart) => (strPathPart !== null) && (strPathPart !== undefined) && (strPathPart.length > 0))
		.map((strPathPart) => NormalizePath(strPathPart).replace(/^\/+/, "").replace(/\/+$/, ""));

	const strJoinedPath = [strNormalizedRoot.replace(/\/+$/, ""), ...vecNormalizedParts].filter(Boolean).join("/");

	return (strNormalizedRoot === "/") ? ("/" + strJoinedPath) : strJoinedPath;
}

function CreateNativePaths(Overrides = {}) {
	if (!Overrides || (typeof Overrides !== "object") || Array.isArray(Overrides)) {
		throw new TypeError("Path overrides must be an object.");
	}

	const strGameRoot = NormalizePath(Overrides.GAME_ROOT ?? "C:/game/left4dead2");
	const strAddonRoot = NormalizePath(Overrides.ADDON_ROOT ?? JoinPath(strGameRoot, "addons"));
	const strBaseRoot = NormalizePath(Overrides.BASE_ROOT ?? JoinPath(strAddonRoot, "sourcejs"));
	const strPackageRoot = NormalizePath(Overrides.PACKAGE_ROOT ?? JoinPath(strBaseRoot, "packages"));
	const strDataRoot = NormalizePath(Overrides.DATA_ROOT ?? JoinPath(strBaseRoot, "data"));
	const strDocumentationRoot = NormalizePath(Overrides.DOCS_ROOT ?? JoinPath(strBaseRoot, "docs"));
	const strConfigurationRoot = NormalizePath(Overrides.CONFIG_ROOT ?? JoinPath(strGameRoot, "cfg/sourcejs"));
	const strResourceRoot = JoinPath(strGameRoot, "resource/sourcejs");
	const strAuthorizationConfigurationRoot = NormalizePath(Overrides.AUTH_CONFIG_ROOT ?? JoinPath(strConfigurationRoot, "auth"));
	const strTranslationRoot = NormalizePath(Overrides.TRANSLATION_ROOT ?? JoinPath(strResourceRoot, "translations"));
	const strTranslationCoreRoot = NormalizePath(Overrides.TRANSLATION_CORE_ROOT ?? JoinPath(strTranslationRoot, "_core"));
	const strUpdateRoot = NormalizePath(Overrides.UPDATE_ROOT ?? JoinPath(strBaseRoot, "update"));

	const NativePaths = {
		ADDON_ROOT: strAddonRoot,
		AUTH_CONFIG_ROOT: strAuthorizationConfigurationRoot,
		AUTH_PARENTS_FILE: JoinPath(strAuthorizationConfigurationRoot, "parents.json"),
		AUTH_PLAYERS_FILE: JoinPath(strAuthorizationConfigurationRoot, "players.json"),
		AUTH_SIMPLE_FILE: JoinPath(strAuthorizationConfigurationRoot, "simple.txt"),
		AUTH_SQL_FILE: JoinPath(strAuthorizationConfigurationRoot, "permissions.sqlite3"),
		BACKEND_CONFIG_FILE: JoinPath(strAuthorizationConfigurationRoot, "permissions.ini"),
		BACKEND_ROOT: JoinPath(strPackageRoot, "sourcejs/auth/backends"),
		BASE_ROOT: strBaseRoot,
		CONFIG_ROOT: strConfigurationRoot,
		CUSTOM_DATA_ROOT: JoinPath(strDataRoot, "custom"),
		CUSTOM_PACKAGE_DOCS_ROOT: JoinPath(strDocumentationRoot, "custom"),
		CUSTOM_PACKAGE_ROOT: JoinPath(strPackageRoot, "custom"),
		DATA_ROOT: strDataRoot,
		DOCS_ROOT: strDocumentationRoot,
		EVENT_ROOT: JoinPath(strResourceRoot, "events"),
		EXTENSION_ROOT: JoinPath(strBaseRoot, "extensions"),
		GAME_ROOT: strGameRoot,
		LANGUAGE_FILE: JoinPath(strDataRoot, "languages.ini"),
		LOG_ROOT: JoinPath(strGameRoot, "logs/sourcejs"),
		PACKAGE_ROOT: strPackageRoot,
		PLUGIN_DATA_ROOT: JoinPath(strDataRoot, "plugins"),
		PLUGIN_DOCS_ROOT: JoinPath(strDocumentationRoot, "plugins"),
		PLUGIN_ROOT: JoinPath(strBaseRoot, "plugins"),
		SITE_PACKAGE_ROOT: JoinPath(strPackageRoot, "site-packages"),
		SOUND_ROOT: JoinPath(strGameRoot, "sound/sourcejs"),
		SOURCE_DATA_ROOT: JoinPath(strDataRoot, "sourcejs"),
		SOURCE_DOCS_ROOT: JoinPath(strDocumentationRoot, "sourcejs"),
		SOURCE_PACKAGE_ROOT: JoinPath(strPackageRoot, "sourcejs"),
		TRANSLATION_CORE_FILE: JoinPath(strTranslationCoreRoot, "translations_strings.ini"),
		TRANSLATION_CORE_ROOT: strTranslationCoreRoot,
		TRANSLATION_ROOT: strTranslationRoot,
		UPDATE_DATA_ROOT: JoinPath(strUpdateRoot, "addons/sourcejs/data"),
		UPDATE_ROOT: strUpdateRoot,
		UPDATE_SOURCE_DATA_ROOT: JoinPath(strUpdateRoot, "addons/sourcejs/data/sourcejs"),
	};

	for (const [strPathName, strPathValue] of Object.entries(Overrides)) {
		if ((strPathValue !== null) && (strPathValue !== undefined)) {
			NativePaths[strPathName] = NormalizePath(strPathValue);
		}
	}

	return NativePaths;
}

module.exports = {
	CreateNativePaths,
};
