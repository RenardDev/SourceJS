function(SourceJSGetBranchDefinitions strOutputVariable strSDKBranch)
	string(TOUPPER "${strSDKBranch}" strSDKBranchUpper)
	string(REPLACE "-" "_" strSDKBranchUpper "${strSDKBranchUpper}")

	set(vecBranchDefinitions "ENGINE_BRANCH_${strSDKBranchUpper}")

	if((strSDKBranch STREQUAL "episode1") OR (strSDKBranch STREQUAL "darkm"))
		list(APPEND vecBranchDefinitions SOURCEJS_OLD_CONSOLE_API)
	endif()

	list(APPEND vecBranchDefinitions GAME_DLL)

	if(strSDKBranch STREQUAL "bms")
		list(APPEND vecBranchDefinitions ENGINE_BMS)
	elseif(strSDKBranch STREQUAL "blade")
		list(APPEND vecBranchDefinitions ENGINE_BLADE)
	elseif(strSDKBranch STREQUAL "csgo")
		list(APPEND vecBranchDefinitions ENGINE_CSGO)
	elseif(strSDKBranch STREQUAL "css")
		list(APPEND vecBranchDefinitions ENGINE_CSS ENGINE_ORANGEBOX)
	elseif(strSDKBranch STREQUAL "dods")
		list(APPEND vecBranchDefinitions ENGINE_DODS ENGINE_ORANGEBOX)
	elseif(strSDKBranch STREQUAL "gmod")
		list(APPEND vecBranchDefinitions ENGINE_GMOD ENGINE_ORANGEBOX)
	elseif(strSDKBranch STREQUAL "hl2dm")
		list(APPEND vecBranchDefinitions ENGINE_HL2DM ENGINE_ORANGEBOX)
	elseif(strSDKBranch STREQUAL "l4d")
		list(APPEND vecBranchDefinitions ENGINE_LEFT4DEAD)
	elseif(strSDKBranch STREQUAL "l4d2")
		list(APPEND vecBranchDefinitions ENGINE_LEFT4DEAD2)
	elseif(strSDKBranch STREQUAL "orangebox")
		list(APPEND vecBranchDefinitions ENGINE_ORANGEBOX)
	elseif(strSDKBranch STREQUAL "sdk2013")
		list(APPEND vecBranchDefinitions ENGINE_SDK2013 ENGINE_ORANGEBOX)
	elseif(strSDKBranch STREQUAL "swarm")
		list(APPEND vecBranchDefinitions ENGINE_ALIENSWARM)
	elseif(strSDKBranch STREQUAL "tf2")
		list(APPEND vecBranchDefinitions ENGINE_TF2 ENGINE_ORANGEBOX)
	endif()

	set(${strOutputVariable} ${vecBranchDefinitions} PARENT_SCOPE)
endfunction()

function(SourceJSGetBranchFeatureDefinitions strOutputVariable strHL2SDKRoot)
	set(vecFeatureDefinitions "")

	foreach(strFeatureHeader IN ITEMS public/dt_common.h public/dt_send.h)
		set(strFeatureHeaderPath "${strHL2SDKRoot}/${strFeatureHeader}")
		if(NOT EXISTS "${strFeatureHeaderPath}")
			continue()
		endif()

		file(READ "${strFeatureHeaderPath}" strFeatureHeaderContent)
		string(FIND "${strFeatureHeaderContent}" "DPT_VectorXY" nVectorXYOffset)
		if(NOT nVectorXYOffset EQUAL -1)
			list(APPEND vecFeatureDefinitions SOURCEJS_HAS_DPT_VECTORXY)
			break()
		endif()
	endforeach()

	set(strConstantsHeaderPath "${strHL2SDKRoot}/public/const.h")
	if(EXISTS "${strConstantsHeaderPath}")
		file(READ "${strConstantsHeaderPath}" strConstantsHeaderContent)
		if(strConstantsHeaderContent MATCHES "kRenderFxDistort")
			list(APPEND vecFeatureDefinitions SOURCEJS_HAS_LEGACY_RENDER_FX)
		endif()

		if(strConstantsHeaderContent MATCHES "kRenderFxFadeOut")
			list(APPEND vecFeatureDefinitions SOURCEJS_HAS_RENDER_FADE_FX)
		endif()

		if(strConstantsHeaderContent MATCHES "COLLISION_GROUP_NPC_SCRIPTED")
			list(APPEND vecFeatureDefinitions SOURCEJS_HAS_COLLISION_GROUP_NPC_SCRIPTED)
		endif()

		if(strConstantsHeaderContent MATCHES "FSOLID_TRIGGER_TOUCH_DEBRIS")
			list(APPEND vecFeatureDefinitions SOURCEJS_HAS_FSOLID_TRIGGER_TOUCH_DEBRIS)
		endif()
	endif()

	set(strBitBufferHeaderPath "${strHL2SDKRoot}/public/tier1/bitbuf.h")
	if(EXISTS "${strBitBufferHeaderPath}")
		file(READ "${strBitBufferHeaderPath}" strBitBufferHeaderContent)
		if(strBitBufferHeaderContent MATCHES "WriteBitCoordMP[^\n]*EBitCoordType")
			list(APPEND vecFeatureDefinitions SOURCEJS_HAS_ENUM_BITCOORD_MP)
		endif()
	endif()

	set(strKeyValuesHeaderPath "${strHL2SDKRoot}/public/tier1/KeyValues.h")
	if(EXISTS "${strKeyValuesHeaderPath}")
		file(READ "${strKeyValuesHeaderPath}" strKeyValuesHeaderContent)
		if(strKeyValuesHeaderContent MATCHES "TYPE_COMPILED_INT_BYTE")
			list(APPEND vecFeatureDefinitions SOURCEJS_HAS_COMPILED_KEYVALUE_TYPES)
		endif()
	endif()

	foreach(strSharedDefinitionsHeader IN ITEMS game/shared/shareddefs.h game_shared/shareddefs.h)
		set(strSharedDefinitionsHeaderPath "${strHL2SDKRoot}/${strSharedDefinitionsHeader}")
		if(NOT EXISTS "${strSharedDefinitionsHeaderPath}")
			continue()
		endif()

		file(READ "${strSharedDefinitionsHeaderPath}" strSharedDefinitionsHeaderContent)
		if(strSharedDefinitionsHeaderContent MATCHES "ITEM_FLAG_NOITEMPICKUP")
			list(APPEND vecFeatureDefinitions SOURCEJS_HAS_ITEM_FLAG_NOITEMPICKUP)
		endif()

		break()
	endforeach()

	foreach(strWeaponParseHeader IN ITEMS game/shared/weapon_parse.h game_shared/weapon_parse.h)
		set(strWeaponParseHeaderPath "${strHL2SDKRoot}/${strWeaponParseHeader}")
		if(NOT EXISTS "${strWeaponParseHeaderPath}")
			continue()
		endif()

		file(READ "${strWeaponParseHeaderPath}" strWeaponParseHeaderContent)
		if(strWeaponParseHeaderContent MATCHES "TAUNT")
			list(APPEND vecFeatureDefinitions SOURCEJS_HAS_WEAPON_SOUND_TAUNT)
		endif()

		if(strWeaponParseHeaderContent MATCHES "UNKNOWNSOUND1")
			list(APPEND vecFeatureDefinitions SOURCEJS_HAS_WEAPON_SOUND_UNKNOWN)
		endif()

		if(strWeaponParseHeaderContent MATCHES "FAST_RELOAD")
			list(APPEND vecFeatureDefinitions SOURCEJS_HAS_WEAPON_SOUND_FAST_RELOAD)
		endif()

		break()
	endforeach()

	set(strEngineSoundHeaderPath "${strHL2SDKRoot}/public/engine/IEngineSound.h")
	if(EXISTS "${strEngineSoundHeaderPath}")
		file(READ "${strEngineSoundHeaderPath}" strEngineSoundHeaderContent)
		if(strEngineSoundHeaderContent MATCHES "StopSound[^\n]*nSoundEntryHash")
			list(APPEND vecFeatureDefinitions SOURCEJS_HAS_SOUND_ENTRY_HASH)
		endif()
	endif()

	set(strServerPluginHeaderPath "${strHL2SDKRoot}/public/engine/iserverplugin.h")
	if(EXISTS "${strServerPluginHeaderPath}")
		file(READ "${strServerPluginHeaderPath}" strServerPluginHeaderContent)
		if(strServerPluginHeaderContent MATCHES "eQueryCvarValueStatus_ValueIntact")
			list(APPEND vecFeatureDefinitions SOURCEJS_HAS_QUERY_CVAR_STATUS)
		endif()

		if(strServerPluginHeaderContent MATCHES "DIALOG_ASKCONNECT")
			list(APPEND vecFeatureDefinitions SOURCEJS_HAS_DIALOG_ASKCONNECT)
		endif()
	endif()

	set(strNetChannelHeaderPath "${strHL2SDKRoot}/public/inetchannel.h")
	if(EXISTS "${strNetChannelHeaderPath}")
		file(READ "${strNetChannelHeaderPath}" strNetChannelHeaderContent)
		if(strNetChannelHeaderContent MATCHES "SendFile[^\n]*isReplayDemo")
			list(APPEND vecFeatureDefinitions SOURCEJS_HAS_REPLAY_FILE_API)
		endif()
	endif()

	set(strDataMapHeaderPath "${strHL2SDKRoot}/public/datamap.h")
	if(EXISTS "${strDataMapHeaderPath}")
		file(READ "${strDataMapHeaderPath}" strDataMapHeaderContent)
		if(strDataMapHeaderContent MATCHES "FIELD_VECTOR2D")
			list(APPEND vecFeatureDefinitions SOURCEJS_HAS_FIELD_VECTOR2D)
		endif()

		if(strDataMapHeaderContent MATCHES "FTYPEDESC_VIEW_OTHER_PLAYER")
			list(APPEND vecFeatureDefinitions SOURCEJS_HAS_EXTENDED_FTYPEDESC_FLAGS)
		endif()
	endif()

	set(${strOutputVariable} ${vecFeatureDefinitions} PARENT_SCOPE)
endfunction()

function(SourceJSGetBranchSupportedArchitectures strOutputVariable strSDKBranch strPlatform)
	if(strPlatform STREQUAL "windows")
		set(vecX86Branches
			bgt blade bms contagion csgo css darkm dods doi episode1 eye gmod
			hl2dm insurgency l4d l4d2 mcv nucleardawn orangebox portal2 pvkii
			sdk2013 swarm tf2
		)
		set(vecX64Branches blade css dods doi hl2dm insurgency mcv tf2)
	elseif(strPlatform STREQUAL "linux")
		set(vecX86Branches
			bgt blade bms contagion csgo css dods doi eye gmod hl2dm insurgency
			l4d l4d2 mcv nucleardawn orangebox pvkii sdk2013 tf2
		)
		set(vecX64Branches blade css dods hl2dm mcv tf2)
	else()
		message(FATAL_ERROR "Unsupported SourceJS platform: ${strPlatform}.")
	endif()

	set(vecSupportedArchitectures "")

	if(strSDKBranch IN_LIST vecX86Branches)
		list(APPEND vecSupportedArchitectures x86)
	endif()

	if(strSDKBranch IN_LIST vecX64Branches)
		list(APPEND vecSupportedArchitectures x64)
	endif()

	if(NOT vecSupportedArchitectures)
		message(FATAL_ERROR "HL2SDK branch ${strSDKBranch} does not support SourceJS on ${strPlatform}.")
	endif()

	set(${strOutputVariable} ${vecSupportedArchitectures} PARENT_SCOPE)
endfunction()

function(SourceJSRequireSupportedTarget strSDKBranch strPlatform strArchitecture)
	SourceJSGetBranchSupportedArchitectures(vecSupportedArchitectures "${strSDKBranch}" "${strPlatform}")
	if(NOT strArchitecture IN_LIST vecSupportedArchitectures)
		list(JOIN vecSupportedArchitectures ", " strSupportedArchitectures)
		message(FATAL_ERROR "HL2SDK branch ${strSDKBranch} does not support ${strPlatform}/${strArchitecture}. Supported architectures for this platform: ${strSupportedArchitectures}.")
	endif()
endfunction()
