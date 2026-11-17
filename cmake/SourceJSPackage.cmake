function(SourceJSGetExistingPaths strOutputVariable)
	set(vecPaths "")

	foreach(strPathEntry IN LISTS ARGN)
		if(EXISTS "${strPathEntry}")
			list(APPEND vecPaths "${strPathEntry}")
		endif()
	endforeach()

	set(${strOutputVariable} ${vecPaths} PARENT_SCOPE)
endfunction()

function(SourceJSRequireNonEmptyList strListName strDescription)
	if(NOT DEFINED ${strListName} OR ("${${strListName}}" STREQUAL ""))
		message(FATAL_ERROR "Unable to find required ${strDescription}.")
	endif()
endfunction()

function(SourceJSLinkExactSharedLibrary strTargetName strLibraryPath)
	get_filename_component(strLibraryName "${strLibraryPath}" NAME)
	if(NOT strLibraryName MATCHES "^lib")
		get_filename_component(strLibraryDirectory "${strLibraryPath}" DIRECTORY)
		target_link_directories(${strTargetName} PRIVATE "${strLibraryDirectory}")
		target_link_libraries(${strTargetName} PRIVATE "-Wl,-l:${strLibraryName}")
		return()
	endif()

	string(SHA256 strLibraryHash "${strLibraryPath}")
	string(SUBSTRING "${strLibraryHash}" 0 16 strLibraryHashShort)
	set(strImportedTarget "sourcejs_hl2sdk_shared_${strLibraryHashShort}")
	if(NOT TARGET ${strImportedTarget})
		add_library(${strImportedTarget} SHARED IMPORTED)
		set_target_properties(${strImportedTarget} PROPERTIES
			IMPORTED_LOCATION "${strLibraryPath}"
			IMPORTED_NO_SONAME TRUE
		)
	endif()

	target_link_libraries(${strTargetName} PRIVATE ${strImportedTarget})
endfunction()

function(SourceJSPrepareHL2SDKCXX20Headers strOutputVariable strHL2SDKRoot)
	set(vecGeneratedIncludeDirectories "")

	if(CMAKE_CXX_COMPILER_ID STREQUAL "GNU")
		set(strGeneratedIncludeRoot "${CMAKE_CURRENT_BINARY_DIR}/sourcejs-hl2sdk-cxx20")
		# These generated overlays must not shadow a newly selected SDK when no patch is needed.
		file(REMOVE "${strGeneratedIncludeRoot}/tier1/utlsymbol.h" "${strGeneratedIncludeRoot}/tier1/UtlStringMap.h")

		set(strSymbolHeader "${strHL2SDKRoot}/public/tier1/utlsymbol.h")
		if(EXISTS "${strSymbolHeader}")
			file(READ "${strSymbolHeader}" strSymbolHeaderContent)
			set(strAmbiguousExpression "return Find( pStr ) != UTL_INVAL_SYMBOL;")
			string(FIND "${strSymbolHeaderContent}" "${strAmbiguousExpression}" nAmbiguousExpressionOffset)
			if(NOT nAmbiguousExpressionOffset EQUAL -1)
				set(strExplicitExpression "return static_cast<UtlSymId_t>( Find( pStr ) ) != UTL_INVAL_SYMBOL;")
				string(REPLACE "${strAmbiguousExpression}" "${strExplicitExpression}" strGeneratedSymbolHeaderContent "${strSymbolHeaderContent}")
				string(PREPEND strGeneratedSymbolHeaderContent "// Generated only: selected HL2SDK CUtlSymbol C++20 compatibility overlay.\n\n")
				file(MAKE_DIRECTORY "${strGeneratedIncludeRoot}/tier1")
				file(WRITE "${strGeneratedIncludeRoot}/tier1/utlsymbol.h" "${strGeneratedSymbolHeaderContent}")
				list(APPEND vecGeneratedIncludeDirectories "${strGeneratedIncludeRoot}" "${strGeneratedIncludeRoot}/tier1")
				message(STATUS "Generated the selected HL2SDK CUtlSymbol C++20 header overlay.")
			endif()
		endif()

		set(strStringMapHeader "${strHL2SDKRoot}/public/tier1/UtlStringMap.h")
		if(EXISTS "${strStringMapHeader}")
			file(READ "${strStringMapHeader}" strStringMapHeaderContent)
			set(strAmbiguousStringMapExpression "return m_SymbolTable.Find( pString ) != UTL_INVAL_SYMBOL;")
			string(FIND "${strStringMapHeaderContent}" "${strAmbiguousStringMapExpression}" nAmbiguousStringMapOffset)
			if(NOT nAmbiguousStringMapOffset EQUAL -1)
				set(strExplicitStringMapExpression "return static_cast<UtlSymId_t>( m_SymbolTable.Find( pString ) ) != UTL_INVAL_SYMBOL;")
				string(REPLACE "${strAmbiguousStringMapExpression}" "${strExplicitStringMapExpression}" strGeneratedStringMapHeaderContent "${strStringMapHeaderContent}")
				string(PREPEND strGeneratedStringMapHeaderContent "// Generated only: selected HL2SDK CUtlStringMap C++20 compatibility overlay.\n\n")
				file(MAKE_DIRECTORY "${strGeneratedIncludeRoot}/tier1")
				file(WRITE "${strGeneratedIncludeRoot}/tier1/UtlStringMap.h" "${strGeneratedStringMapHeaderContent}")
				list(APPEND vecGeneratedIncludeDirectories "${strGeneratedIncludeRoot}" "${strGeneratedIncludeRoot}/tier1")
				message(STATUS "Generated the selected HL2SDK CUtlStringMap C++20 header overlay.")
			endif()
		endif()

		# Clear only this generated family before re-evaluating the SDK requirements.
		file(REMOVE "${strGeneratedIncludeRoot}/tier1/utlmemory.h" "${strGeneratedIncludeRoot}/sourcejs_sdk_utility_compat.h")

		set(strMemoryHeader "${strHL2SDKRoot}/public/tier1/utlmemory.h")
		if(EXISTS "${strMemoryHeader}")
			file(READ "${strMemoryHeader}" strMemoryHeaderContent)
			set(strGeneratedMemoryHeaderContent "${strMemoryHeaderContent}")
			set(strMathLibraryHeader "${strHL2SDKRoot}/public/mathlib/mathlib.h")
			set(bMathLibraryHasVSwap FALSE)

			if(EXISTS "${strMathLibraryHeader}")
				file(READ "${strMathLibraryHeader}" strMathLibraryHeaderContent)
				if(strMathLibraryHeaderContent MATCHES "V_swap")
					set(bMathLibraryHasVSwap TRUE)
				endif()
			endif()

			if(bMathLibraryHasVSwap)
				string(REPLACE "V_swap( m_" "SOURCEJS_V_SWAP( m_" strGeneratedMemoryHeaderContent "${strGeneratedMemoryHeaderContent}")
				string(REPLACE "swap( m_" "V_swap( m_" strGeneratedMemoryHeaderContent "${strGeneratedMemoryHeaderContent}")
				string(REPLACE "SOURCEJS_V_SWAP( m_" "V_swap( m_" strGeneratedMemoryHeaderContent "${strGeneratedMemoryHeaderContent}")
			else()
				# Preserve the SDK's exact V_swap spelling when mathlib does not define it.
				string(CONCAT strSDKUtilityCompatibilityHeaderContent
					"#pragma once\n"
					"\n"
					"// Generated only: selected HL2SDK swap utility compatibility header.\n"
					"\n"
					"// C++\n"
					"#include <utility>\n"
					"\n"
					"template <typename T>\n"
					"inline void V_swap(T& ValueLeft, T& ValueRight) {\n"
					"\tstd::swap(ValueLeft, ValueRight);\n"
					"}\n"
				)

				file(MAKE_DIRECTORY "${strGeneratedIncludeRoot}")
				file(WRITE "${strGeneratedIncludeRoot}/sourcejs_sdk_utility_compat.h" "${strSDKUtilityCompatibilityHeaderContent}")
				list(APPEND vecGeneratedIncludeDirectories "${strGeneratedIncludeRoot}")
				message(STATUS "Generated the selected HL2SDK swap utility compatibility header.")
			endif()

			string(REPLACE "_aligned_malloc(" "MemAlloc_AllocAligned(" strGeneratedMemoryHeaderContent "${strGeneratedMemoryHeaderContent}")
			string(REPLACE "_aligned_free(" "MemAlloc_FreeAligned(" strGeneratedMemoryHeaderContent "${strGeneratedMemoryHeaderContent}")
			if(NOT strGeneratedMemoryHeaderContent STREQUAL strMemoryHeaderContent)
				string(PREPEND strGeneratedMemoryHeaderContent "// Generated only: selected HL2SDK CUtlMemory compatibility overlay.\n\n")
				file(MAKE_DIRECTORY "${strGeneratedIncludeRoot}/tier1")
				file(WRITE "${strGeneratedIncludeRoot}/tier1/utlmemory.h" "${strGeneratedMemoryHeaderContent}")
				list(APPEND vecGeneratedIncludeDirectories "${strGeneratedIncludeRoot}" "${strGeneratedIncludeRoot}/tier1")
				message(STATUS "Generated the selected HL2SDK CUtlMemory swap header overlay.")
			endif()
		endif()

		file(REMOVE "${strGeneratedIncludeRoot}/game/shared/collisionproperty.h")

		set(strCollisionPropertyHeader "${strHL2SDKRoot}/game/shared/collisionproperty.h")
		set(strCollideableHeader "${strHL2SDKRoot}/public/engine/ICollideable.h")
		if(EXISTS "${strCollisionPropertyHeader}" AND EXISTS "${strCollideableHeader}")
			file(READ "${strCollisionPropertyHeader}" strCollisionPropertyHeaderContent)
			file(READ "${strCollideableHeader}" strCollideableHeaderContent)
			set(strCollisionTransformDeclaration "virtual const matrix3x4_t *GetRootParentToWorldTransform() const;")
			string(FIND "${strCollisionPropertyHeaderContent}" "${strCollisionTransformDeclaration}" nCollisionTransformDeclarationOffset)
			if((strCollideableHeaderContent MATCHES "GetVPhysicsObject[^\n]*= 0") AND NOT (strCollisionPropertyHeaderContent MATCHES "GetVPhysicsObject") AND NOT (nCollisionTransformDeclarationOffset EQUAL -1))
				string(CONCAT strCollisionVPhysicsDeclarations
					"virtual matrix3x4_t const* GetRootParentToWorldTransform() const;\n"
					"\tvirtual IPhysicsObject* GetVPhysicsObject() const;"
				)
				string(REPLACE "${strCollisionTransformDeclaration}" "${strCollisionVPhysicsDeclarations}" strGeneratedCollisionPropertyHeaderContent "${strCollisionPropertyHeaderContent}")
				string(PREPEND strGeneratedCollisionPropertyHeaderContent "// Generated only: selected HL2SDK collision-property compatibility overlay.\n\n")
				file(MAKE_DIRECTORY "${strGeneratedIncludeRoot}/game/shared")
				file(WRITE "${strGeneratedIncludeRoot}/game/shared/collisionproperty.h" "${strGeneratedCollisionPropertyHeaderContent}")
				list(APPEND vecGeneratedIncludeDirectories "${strGeneratedIncludeRoot}/game/shared")
				message(STATUS "Generated the selected HL2SDK CCollisionProperty interface repair header.")
			endif()
		endif()

		file(REMOVE "${strGeneratedIncludeRoot}/networkvar.h" "${strGeneratedIncludeRoot}/appframework/iappsystem.h")

		set(strNetworkVariableHeader "${strHL2SDKRoot}/public/networkvar.h")
		if(EXISTS "${strNetworkVariableHeader}")
			file(READ "${strNetworkVariableHeader}" strNetworkVariableHeaderContent)
			set(strAddressOffsetExpression "#define MyOffsetOf( type, var ) ( (int)&((type*)0)->var )")
			string(FIND "${strNetworkVariableHeaderContent}" "${strAddressOffsetExpression}" nAddressOffsetExpressionOffset)
			if(NOT nAddressOffsetExpressionOffset EQUAL -1)
				set(strAddressSizedOffsetExpression [=[// C++
#include <cstddef>

// STL
#include <limits>

// GCC supports member offsets for the SDK's non-standard-layout classes.
// Suppress only that diagnostic at the builtin; restore it before other code.
// Preserve the SDK's MyOffsetOf spelling while range-checking the int result.
#define MyOffsetOf(TYPE, VARIABLE) ([]() constexpr -> int { \
	_Pragma("GCC diagnostic push") \
	_Pragma("GCC diagnostic ignored \"-Winvalid-offsetof\"") \
	constexpr std::size_t kOffset = __builtin_offsetof(TYPE, VARIABLE); \
	_Pragma("GCC diagnostic pop") \
	\
	static_assert(kOffset <= static_cast<std::size_t>(std::numeric_limits<int>::max()), "SDK member offset exceeds int"); \
	\
	return static_cast<int>(kOffset); \
}())]=])
				string(REPLACE "${strAddressOffsetExpression}" "${strAddressSizedOffsetExpression}" strGeneratedNetworkVariableHeaderContent "${strNetworkVariableHeaderContent}")
				string(PREPEND strGeneratedNetworkVariableHeaderContent "// Generated only: selected HL2SDK address-sized networkvar compatibility overlay.\n\n")
				file(MAKE_DIRECTORY "${strGeneratedIncludeRoot}")
				file(WRITE "${strGeneratedIncludeRoot}/networkvar.h" "${strGeneratedNetworkVariableHeaderContent}")
				list(APPEND vecGeneratedIncludeDirectories "${strGeneratedIncludeRoot}")
				message(STATUS "Generated the selected HL2SDK address-sized networkvar header overlay.")
			endif()
		endif()

		set(strAppSystemHeader "${strHL2SDKRoot}/public/appframework/IAppSystem.h")
		set(strLowercaseAppSystemHeader "${strHL2SDKRoot}/public/appframework/iappsystem.h")
		if(EXISTS "${strAppSystemHeader}" AND NOT EXISTS "${strLowercaseAppSystemHeader}")
			file(READ "${strAppSystemHeader}" strAppSystemHeaderContent)
			string(PREPEND strAppSystemHeaderContent "// Generated only: selected HL2SDK case-correct IAppSystem compatibility overlay.\n\n")
			file(MAKE_DIRECTORY "${strGeneratedIncludeRoot}/appframework")
			file(WRITE "${strGeneratedIncludeRoot}/appframework/iappsystem.h" "${strAppSystemHeaderContent}")
			list(APPEND vecGeneratedIncludeDirectories "${strGeneratedIncludeRoot}")
			message(STATUS "Generated the selected HL2SDK case-correct IAppSystem header overlay.")
		endif()

		list(REMOVE_DUPLICATES vecGeneratedIncludeDirectories)
	endif()

	set(${strOutputVariable} ${vecGeneratedIncludeDirectories} PARENT_SCOPE)
endfunction()

function(SourceJSPrepareHL2SDKMSVCHeaders strOutputIncludeDirectories strOutputPreIncludeHeader strHL2SDKRoot strArchitecture)
	set(vecGeneratedIncludeDirectories "")
	set(strPreIncludeHeader "")

	if(NOT CMAKE_CXX_COMPILER_ID STREQUAL "MSVC")
		set(${strOutputIncludeDirectories} "" PARENT_SCOPE)
		set(${strOutputPreIncludeHeader} "" PARENT_SCOPE)
		return()
	endif()

	set(strGeneratedIncludeRoot "${CMAKE_CURRENT_BINARY_DIR}/sourcejs-hl2sdk-msvc")
	set(strPreIncludeHeader "${strGeneratedIncludeRoot}/sourcejs_sdk_compatibility.h")
	file(MAKE_DIRECTORY "${strGeneratedIncludeRoot}")
	string(CONCAT strPreIncludeContent
		"#pragma once\n"
		"\n"
		"// Generated only: selected HL2SDK MSVC pre-include compatibility header.\n"
		"\n"
		"// C++\n"
		"#include <ctime>\n"
		"\n"
		"// STL\n"
		"#include <algorithm>\n"
		"#include <chrono>\n"
		"#include <type_traits>\n"
	)

	set(bNeedsGlobalMinMax FALSE)

	foreach(strMinMaxHeader IN ITEMS
		"${strHL2SDKRoot}/public/mathlib/vector.h"
		"${strHL2SDKRoot}/public/tier0/threadtools.h"
	)
		if(NOT EXISTS "${strMinMaxHeader}")
			continue()
		endif()

		file(READ "${strMinMaxHeader}" strMinMaxHeaderContent)
		if((strMinMaxHeaderContent MATCHES "[^A-Za-z0-9_]min[ \t]*\\(") OR (strMinMaxHeaderContent MATCHES "[^A-Za-z0-9_]max[ \t]*\\("))
			set(bNeedsGlobalMinMax TRUE)
		endif()
	endforeach()

	# Keep the unqualified SDK min/max names only when selected headers use them.
	if(bNeedsGlobalMinMax)
		string(APPEND strPreIncludeContent
			"\n"
			"template <typename TLeft, typename TRight>\n"
			"constexpr std::common_type_t<TLeft, TRight> min(const TLeft ValueLeft, const TRight ValueRight) {\n"
			"\tusing ResultType = std::common_type_t<TLeft, TRight>;\n"
			"\n"
			"\treturn std::min(static_cast<ResultType>(ValueLeft), static_cast<ResultType>(ValueRight));\n"
			"}\n"
			"\n"
			"template <typename TLeft, typename TRight>\n"
			"constexpr std::common_type_t<TLeft, TRight> max(const TLeft ValueLeft, const TRight ValueRight) {\n"
			"\tusing ResultType = std::common_type_t<TLeft, TRight>;\n"
			"\n"
			"\treturn std::max(static_cast<ResultType>(ValueLeft), static_cast<ResultType>(ValueRight));\n"
			"}\n"
		)
		message(STATUS "Generated the selected HL2SDK global min/max compatibility functions.")
	endif()

	set(strPlatformHeader "${strHL2SDKRoot}/public/tier0/platform.h")
	if(EXISTS "${strPlatformHeader}")
		file(STRINGS "${strPlatformHeader}" vecSDKMinMaxIncludes REGEX "valve_minmax_on[.]h")
		if(vecSDKMinMaxIncludes)
			string(APPEND strPreIncludeContent
				"\n"
				"// Parse legacy SDK platform declarations before removing their min/max macros.\n"
				"#pragma push_macro(\"offsetof\")\n"
				"#include \"tier0/platform.h\"\n"
				"#pragma pop_macro(\"offsetof\")\n"
				"#undef min\n"
				"#undef max\n"
			)
		endif()
	endif()

	set(strMemoryHeader "${strHL2SDKRoot}/public/tier1/utlmemory.h")
	set(strMathLibraryHeader "${strHL2SDKRoot}/public/mathlib/mathlib.h")
	set(strMathLibraryPreIncludeHeader "${strGeneratedIncludeRoot}/sourcejs_sdk_early_mathlib.h")
	file(REMOVE "${strMathLibraryPreIncludeHeader}")
	if(EXISTS "${strMemoryHeader}")
		file(READ "${strMemoryHeader}" strMemoryHeaderContent)
		set(strMathLibraryHeaderContent "")
		if(EXISTS "${strMathLibraryHeader}")
			file(READ "${strMathLibraryHeader}" strMathLibraryHeaderContent)
		endif()

		set(bNeedsEarlyMathLibrary FALSE)
		if(strMemoryHeaderContent MATCHES "[\n\t ]swap\\( m_")
			if(strMathLibraryHeaderContent MATCHES "void swap\\(")
				set(bNeedsEarlyMathLibrary TRUE)
			else()
				string(APPEND strPreIncludeContent "\n#include <utility>\n\nusing std::swap;\n")
			endif()
		endif()

		if((strMemoryHeaderContent MATCHES "[\n\t ]V_swap\\( m_") AND (strMathLibraryHeaderContent MATCHES "void V_swap\\("))
			set(bNeedsEarlyMathLibrary TRUE)
		endif()

		if(bNeedsEarlyMathLibrary)
			file(WRITE "${strMathLibraryPreIncludeHeader}"
				"#pragma once\n\n"
				"// Generated only: selected HL2SDK declares its swap helper in mathlib.\n\n"
				"#include \"sourcejs_sdk_compatibility.h\"\n"
				"#pragma push_macro(\"offsetof\")\n"
				"#include \"mathlib/mathlib.h\"\n"
				"#pragma pop_macro(\"offsetof\")\n"
			)
			set_property(SOURCE src/sourcejs/modules/ModuleBindings.cpp APPEND PROPERTY COMPILE_OPTIONS "/FI${strMathLibraryPreIncludeHeader}")
		endif()
	endif()

	file(WRITE "${strPreIncludeHeader}" "${strPreIncludeContent}")

	# Legacy SDK debug headers use a pre-standard MSVC type-information spelling.
	file(REMOVE "${strGeneratedIncludeRoot}/typeinfo.h")
	set(strMemoryAllocationHeader "${strHL2SDKRoot}/public/tier0/memalloc.h")
	if(EXISTS "${strMemoryAllocationHeader}")
		file(READ "${strMemoryAllocationHeader}" strMemoryAllocationHeaderContent)
		if(strMemoryAllocationHeaderContent MATCHES "#[ \t]*include[ \t]*[<\"]typeinfo[.]h[>\"]")
			string(CONCAT strTypeInformationHeaderContent
				"#pragma once\n"
				"\n"
				"// Generated only: selected HL2SDK MSVC type-information compatibility header.\n"
				"\n"
				"// C++\n"
				"#include <typeinfo>\n"
			)
			file(WRITE "${strGeneratedIncludeRoot}/typeinfo.h" "${strTypeInformationHeaderContent}")
			list(APPEND vecGeneratedIncludeDirectories "${strGeneratedIncludeRoot}")
			message(STATUS "Generated the selected HL2SDK MSVC debug type-information compatibility header.")
		endif()
	endif()

	file(REMOVE "${strGeneratedIncludeRoot}/game/shared/collisionproperty.h" "${strGeneratedIncludeRoot}/sourcejs_sdk_collisionproperty.h")

	set(strCollisionPropertyHeader "${strHL2SDKRoot}/game/shared/collisionproperty.h")
	set(strCollideableHeader "${strHL2SDKRoot}/public/engine/ICollideable.h")
	if(EXISTS "${strCollisionPropertyHeader}" AND EXISTS "${strCollideableHeader}")
		file(READ "${strCollisionPropertyHeader}" strCollisionPropertyHeaderContent)
		file(READ "${strCollideableHeader}" strCollideableHeaderContent)
		set(strCollisionTransformDeclaration "virtual const matrix3x4_t *GetRootParentToWorldTransform() const;")
		string(FIND "${strCollisionPropertyHeaderContent}" "${strCollisionTransformDeclaration}" nCollisionTransformDeclarationOffset)
		if((strCollideableHeaderContent MATCHES "GetVPhysicsObject[^\n]*= 0") AND NOT (strCollisionPropertyHeaderContent MATCHES "GetVPhysicsObject") AND NOT (nCollisionTransformDeclarationOffset EQUAL -1))
			string(CONCAT strCollisionVPhysicsDeclarations
				"virtual matrix3x4_t const* GetRootParentToWorldTransform() const;\n"
				"\tvirtual IPhysicsObject* GetVPhysicsObject() const;"
			)
			string(REPLACE "${strCollisionTransformDeclaration}" "${strCollisionVPhysicsDeclarations}" strGeneratedCollisionPropertyHeaderContent "${strCollisionPropertyHeaderContent}")
			string(PREPEND strGeneratedCollisionPropertyHeaderContent "// Generated only: selected HL2SDK collision-property compatibility overlay.\n\n")
			file(MAKE_DIRECTORY "${strGeneratedIncludeRoot}/game/shared")
			file(WRITE "${strGeneratedIncludeRoot}/game/shared/collisionproperty.h" "${strGeneratedCollisionPropertyHeaderContent}")
			file(WRITE "${strGeneratedIncludeRoot}/sourcejs_sdk_collisionproperty.h" "${strGeneratedCollisionPropertyHeaderContent}")
			list(APPEND vecGeneratedIncludeDirectories "${strGeneratedIncludeRoot}" "${strGeneratedIncludeRoot}/game/shared")
			message(STATUS "Generated the selected HL2SDK MSVC CCollisionProperty interface repair header.")
		endif()
	endif()

	file(REMOVE "${strGeneratedIncludeRoot}/tier2/resourceprecacher.h")

	set(strResourcePrecacherHeader "${strHL2SDKRoot}/public/tier2/resourceprecacher.h")
	if((strArchitecture STREQUAL "x64") AND EXISTS "${strResourcePrecacherHeader}")
		file(READ "${strResourcePrecacherHeader}" strResourcePrecacherHeaderContent)
		if(strResourcePrecacherHeaderContent MATCHES "#error[^\n]*PRECACHE_INDEX")
			string(REGEX REPLACE "#error[^\n]*PRECACHE_INDEX[^\n]*" "" strGeneratedResourcePrecacherHeaderContent "${strResourcePrecacherHeaderContent}")
			string(APPEND strGeneratedResourcePrecacherHeaderContent
				"\n"
				"// The SDK cannot safely use address-backed precache indices on x64.\n"
				"// Permit header parsing, but reject either unsupported macro at its use site.\n"
				"#undef PRECACHE_INDEX\n"
				"#define PRECACHE_INDEX(...) static_assert(false, \"PRECACHE_INDEX is unsupported by this SDK on x64\");\n"
				"#undef PRECACHE_INDEX_CONDITIONAL\n"
				"#define PRECACHE_INDEX_CONDITIONAL(...) static_assert(false, \"PRECACHE_INDEX_CONDITIONAL is unsupported by this SDK on x64\");\n"
			)
			string(PREPEND strGeneratedResourcePrecacherHeaderContent "// Generated only: selected HL2SDK x64 resource-precacher compatibility overlay.\n\n")
			file(MAKE_DIRECTORY "${strGeneratedIncludeRoot}/tier2")
			file(WRITE "${strGeneratedIncludeRoot}/tier2/resourceprecacher.h" "${strGeneratedResourcePrecacherHeaderContent}")
			list(APPEND vecGeneratedIncludeDirectories "${strGeneratedIncludeRoot}")
			message(STATUS "Generated the selected HL2SDK x64 resource precacher parse overlay.")
		endif()
	endif()

	list(REMOVE_DUPLICATES vecGeneratedIncludeDirectories)
	set(${strOutputIncludeDirectories} ${vecGeneratedIncludeDirectories} PARENT_SCOPE)
	set(${strOutputPreIncludeHeader} "${strPreIncludeHeader}" PARENT_SCOPE)
endfunction()

function(SourceJSPrepareLinuxX86Archive strOutputVariable strTargetName strSourceDirectory strArchive strComponent)
	# Some pinned SDKs ship i386 members built without PIC. Rebuild only
	# the known linked members with absolute relocations in read-only sections.
	set(vecRebuildableSources ${ARGN})
	set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${strArchive}")
	execute_process(
		COMMAND "${CMAKE_COMMAND}" -E env LC_ALL=C "${CMAKE_READELF}" -Wr "${strArchive}"
		OUTPUT_VARIABLE strRelocations
		COMMAND_ERROR_IS_FATAL ANY
	)
	string(REPLACE "\nFile: " "\n;File: " vecArchiveMembers "${strRelocations}")
	set(vecOriginalMembers "")
	set(vecSources "")
	foreach(strArchiveMember IN LISTS vecArchiveMembers)
		if(NOT strArchiveMember MATCHES "^File: [^\n]+\\(([^()\n]+)[.]o\\)")
			continue()
		endif()

		set(strMemberName "${CMAKE_MATCH_1}")
		set(strSourceFile "${strMemberName}.cpp")
		if(NOT (strSourceFile IN_LIST vecRebuildableSources) OR NOT EXISTS "${strSourceDirectory}/${strSourceFile}")
			continue()
		endif()

		string(REPLACE "\n\n" ";" vecRelocationSections "${strArchiveMember}")
		foreach(strSection IN LISTS vecRelocationSections)
			if(NOT strSection MATCHES "^Relocation section '[.]rel[.](eh_frame|text|rodata|gcc_except_table)[.']")
				continue()
			endif()

			# Legacy objects also call selected imported libc/tier0 functions without a PLT.
			if((strSection MATCHES "[ \t]R_386_32[ \t]") OR (strSection MATCHES "R_386_PC32[ \t]+[0-9a-fA-F]+[ \t]+(_AssertValid(Read|Write)Ptr|AssertValidStringPtr|mem(cpy|cmp|move|set)|to(upper|lower))([ \t\r\n]|$)"))
				list(APPEND vecOriginalMembers "${strMemberName}.o")
				list(APPEND vecSources "${strSourceDirectory}/${strSourceFile}")
				break()
			endif()
		endforeach()
	endforeach()

	if(NOT vecSources)
		set(${strOutputVariable} "${strArchive}" PARENT_SCOPE)
		return()
	endif()

	set(strObjectsTarget "${strTargetName}_${strComponent}_pic_objects")
	set(strArchiveTarget "${strTargetName}_${strComponent}_pic_archive")
	set(strPICArchive "${CMAKE_CURRENT_BINARY_DIR}/libsourcejs_${strComponent}_pic.a")
	set(strMathSource "${strSourceDirectory}/mathlib_base.cpp")
	if((strComponent STREQUAL "mathlib") AND (strMathSource IN_LIST vecSources))
		set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${strMathSource}")
		file(READ "${strMathSource}" strMathSourceContents)
		set(strOriginalMathSourceContents "${strMathSourceContents}")
		if(strMathSourceContents MATCHES "float t = CalcClosestPointToLineT(2D)?\\(")
			# The SDK clamp template requires equal argument types.
			string(REPLACE "clamp( t, 0, 1 )" "clamp( t, 0.0f, 1.0f )" strMathSourceContents "${strMathSourceContents}")
			# These old POSIX implementations used unqualified Windows min/max.
			foreach(strExpression IN ITEMS "min( sinom, 1.f )" "max( rgb.x, rgb.y )" "max( flMax, rgb.z )" "min( rgb.x, rgb.y )" "min( flMin, rgb.z )")
				string(REPLACE "= ${strExpression}" "= std::${strExpression}" strMathSourceContents "${strMathSourceContents}")
			endforeach()
		endif()

		if(strMathSourceContents MATCHES "(^|\n)const Vector vec3_origin\\(0,0,0\\);")
			execute_process(
				COMMAND "${CMAKE_NM}" -Ag --defined-only "${strArchive}"
				OUTPUT_VARIABLE strMathSymbols
				COMMAND_ERROR_IS_FATAL ANY
			)
			if(strMathSymbols MATCHES ":vector[.]o:[0-9a-fA-F]+ [A-Z] vec3_origin(\r?\n|$)")
				# The vector archive member owns this SDK global.
				string(REPLACE "\nconst Vector vec3_origin(0,0,0);" "\nextern const Vector vec3_origin;" strMathSourceContents "${strMathSourceContents}")
			endif()
		endif()

		if(NOT (strMathSourceContents STREQUAL strOriginalMathSourceContents))
			set(strGeneratedMathSource "${CMAKE_CURRENT_BINARY_DIR}/${strObjectsTarget}/mathlib_base.cpp")
			file(GENERATE OUTPUT "${strGeneratedMathSource}" CONTENT "// Generated SDK compatibility source; do not edit.\n${strMathSourceContents}")
			list(REMOVE_ITEM vecSources "${strMathSource}")
			list(APPEND vecSources "${strGeneratedMathSource}")
		endif()
	endif()

	set(strVectorSource "${strSourceDirectory}/vector.cpp")
	if((strComponent STREQUAL "mathlib") AND (strVectorSource IN_LIST vecSources))
		set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${strVectorSource}")
		file(READ "${strVectorSource}" strVectorSourceContents)
		if(strVectorSourceContents MATCHES "(^|\n)Vector vec3_origin\\(0,0,0\\);")
			# Match the selected SDK's declaration in mathlib.h.
			string(REPLACE "\nVector vec3_origin(0,0,0);" "\nconst Vector vec3_origin(0,0,0);" strVectorSourceContents "${strVectorSourceContents}")
			set(strGeneratedVectorSource "${CMAKE_CURRENT_BINARY_DIR}/${strObjectsTarget}/vector.cpp")
			file(GENERATE OUTPUT "${strGeneratedVectorSource}" CONTENT "// Generated SDK compatibility source; do not edit.\n${strVectorSourceContents}")
			list(REMOVE_ITEM vecSources "${strVectorSource}")
			list(APPEND vecSources "${strGeneratedVectorSource}")
		endif()
	endif()

	if(strComponent STREQUAL "mathlib")
		set(str3DNowSource "${strSourceDirectory}/3dnow.cpp")
		if(str3DNowSource IN_LIST vecSources)
			set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${str3DNowSource}")
			file(READ "${str3DNowSource}" str3DNowSourceContents)
			set(strWindows3DNowHeader "#include \"mathlib/amd3dx.h\"")
			if((str3DNowSourceContents MATCHES "mathlib/amd3dx[.]h") AND NOT EXISTS "${strSourceDirectory}/../public/mathlib/amd3dx.h")
				# This header supplies MSVC assembler macros; the Linux code uses inline assembly.
				string(REPLACE "${strWindows3DNowHeader}" "#if defined(_WIN32)\n${strWindows3DNowHeader}\n#endif" str3DNowSourceContents "${str3DNowSourceContents}")
				set(strGenerated3DNowSource "${CMAKE_CURRENT_BINARY_DIR}/${strObjectsTarget}/3dnow.cpp")
				file(GENERATE OUTPUT "${strGenerated3DNowSource}" CONTENT "// Generated SDK compatibility source; do not edit.\n${str3DNowSourceContents}")
				list(REMOVE_ITEM vecSources "${str3DNowSource}")
				list(APPEND vecSources "${strGenerated3DNowSource}")
			endif()
		endif()

		foreach(strSSEFile IN ITEMS sse.cpp sseconst.cpp)
			set(strSSESource "${strSourceDirectory}/${strSSEFile}")
			if(NOT strSSESource IN_LIST vecSources)
				continue()
			endif()

			set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${strSSESource}")
			file(READ "${strSSESource}" strSSESourceContents)
			# Keep the exact bit patterns in the SDK's signed 32-bit SIMD arrays.
			string(REGEX REPLACE "0[xX](80000000|[fF][fF][fF][fF][fF][fF][fF][eEfF])([^a-zA-Z_0-9])" "static_cast<int32>(0x\\1)\\2" strSignedMaskSourceContents "${strSSESourceContents}")
			if(NOT (strSignedMaskSourceContents STREQUAL strSSESourceContents))
				set(strGeneratedSSESource "${CMAKE_CURRENT_BINARY_DIR}/${strObjectsTarget}/${strSSEFile}")
				file(GENERATE OUTPUT "${strGeneratedSSESource}" CONTENT "// Generated SDK compatibility source; do not edit.\n${strSignedMaskSourceContents}")
				list(REMOVE_ITEM vecSources "${strSSESource}")
				list(APPEND vecSources "${strGeneratedSSESource}")
			endif()
		endforeach()
	endif()

	set(strStringSource "${strSourceDirectory}/strtools.cpp")
	if((strComponent STREQUAL "tier1") AND (strStringSource IN_LIST vecSources))
		set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${strStringSource}")
		file(READ "${strStringSource}" strStringSourceContents)
		if(strStringSourceContents MATCHES "iconv_open\\(")
			set(strOriginalStringSourceContents "${strStringSourceContents}")
			# POSIX iconv_open uses (iconv_t)-1, not an ordered pointer comparison.
			string(REPLACE "if ( conv_t > 0 )" "if ( conv_t != reinterpret_cast<iconv_t>(-1) )" strStringSourceContents "${strStringSourceContents}")
			string(REPLACE "= min( src - path, destSize - 1 )" "= std::min<std::ptrdiff_t>( src - path, destSize - 1 )" strStringSourceContents "${strStringSourceContents}")
			if(NOT (strStringSourceContents STREQUAL strOriginalStringSourceContents))
				set(strGeneratedStringSource "${CMAKE_CURRENT_BINARY_DIR}/${strObjectsTarget}/strtools.cpp")
				file(GENERATE OUTPUT "${strGeneratedStringSource}" CONTENT "// Generated SDK compatibility source; do not edit.\n#include <algorithm>\n#include <cstddef>\n\nusing std::min;\nusing std::max;\n\n${strStringSourceContents}")
				list(REMOVE_ITEM vecSources "${strStringSource}")
				list(APPEND vecSources "${strGeneratedStringSource}")
			endif()
		endif()
	endif()

	add_library(${strObjectsTarget} OBJECT ${vecSources})
	# Older SDK implementation files use GNU typeof and the POSIX alloca spelling.
	set_target_properties(${strObjectsTarget} PROPERTIES CXX_STANDARD 20 CXX_STANDARD_REQUIRED ON CXX_EXTENSIONS ON POSITION_INDEPENDENT_CODE ON)
	get_target_property(vecIncludeDirectories ${strTargetName} INCLUDE_DIRECTORIES)
	get_target_property(vecCompileDefinitions ${strTargetName} COMPILE_DEFINITIONS)
	get_target_property(vecCompileOptions ${strTargetName} COMPILE_OPTIONS)
	target_include_directories(${strObjectsTarget} PRIVATE "${strSourceDirectory}" ${vecIncludeDirectories})
	target_compile_definitions(${strObjectsTarget} PRIVATE ${vecCompileDefinitions} RAD_TELEMETRY_DISABLED _alloca=alloca)
	target_compile_options(${strObjectsTarget} PRIVATE ${vecCompileOptions})

	add_custom_command(
		OUTPUT "${strPICArchive}"
		COMMAND "${CMAKE_COMMAND}" -E copy "${strArchive}" "${strPICArchive}"
		COMMAND "${CMAKE_AR}" d "${strPICArchive}" ${vecOriginalMembers}
		COMMAND "${CMAKE_AR}" rcs "${strPICArchive}" $<TARGET_OBJECTS:${strObjectsTarget}>
		DEPENDS "${strArchive}" $<TARGET_OBJECTS:${strObjectsTarget}>
		COMMAND_EXPAND_LISTS
		VERBATIM
	)
	add_custom_target(${strArchiveTarget} DEPENDS "${strPICArchive}")
	add_dependencies(${strArchiveTarget} ${strObjectsTarget})
	add_dependencies(${strTargetName} ${strArchiveTarget})
	message(STATUS "Rebuilding selected Linux x86 ${strComponent} members with PIC: ${vecOriginalMembers}")
	set(${strOutputVariable} "${strPICArchive}" PARENT_SCOPE)
endfunction()

function(SourceJSLinkHL2SDK strTargetName strHL2SDKRoot strPlatform strArchitecture)
	if(NOT (strArchitecture STREQUAL "x86") AND NOT (strArchitecture STREQUAL "x64"))
		message(FATAL_ERROR "Unsupported SourceJS architecture: ${strArchitecture}.")
	endif()

	if(strPlatform STREQUAL "windows")
		if(strArchitecture STREQUAL "x64")
			set(vecLibraryRootCandidates "${strHL2SDKRoot}/lib/public/x64" "${strHL2SDKRoot}/lib/public/win64")
		else()
			set(vecLibraryRootCandidates "${strHL2SDKRoot}/lib/public/x86" "${strHL2SDKRoot}/lib/public")
		endif()
	elseif(strPlatform STREQUAL "linux")
		if(strArchitecture STREQUAL "x64")
			set(vecLibraryRootCandidates "${strHL2SDKRoot}/lib/public/linux64" "${strHL2SDKRoot}/lib/linux64")
		else()
			set(vecLibraryRootCandidates
				"${strHL2SDKRoot}/lib/public/linux"
				"${strHL2SDKRoot}/lib/public/linux32"
				"${strHL2SDKRoot}/lib/linux"
				"${strHL2SDKRoot}/lib/linux32"
			)
		endif()
	else()
		message(FATAL_ERROR "Unsupported SourceJS platform: ${strPlatform}.")
	endif()

	set(strLibraryRoot "")

	foreach(strLibraryRootCandidate IN LISTS vecLibraryRootCandidates)
		if(strPlatform STREQUAL "windows")
			set(strMathLibraryCandidate "${strLibraryRootCandidate}/mathlib.lib")
			set(strTier1Candidate "${strLibraryRootCandidate}/tier1.lib")
			set(strTier0Candidate "${strLibraryRootCandidate}/tier0.lib")
		else()
			set(strMathLibraryCandidate "${strLibraryRootCandidate}/mathlib.a")
			set(strTier1Candidate "${strLibraryRootCandidate}/tier1.a")

			if(strArchitecture STREQUAL "x86")
				if(EXISTS "${strLibraryRootCandidate}/mathlib_i486.a")
					set(strMathLibraryCandidate "${strLibraryRootCandidate}/mathlib_i486.a")
				endif()

				if(EXISTS "${strLibraryRootCandidate}/tier1_i486.a")
					set(strTier1Candidate "${strLibraryRootCandidate}/tier1_i486.a")
				endif()
			endif()

			set(strTier0Candidate "${strLibraryRootCandidate}/libtier0_srv.so")
			if(NOT EXISTS "${strTier0Candidate}")
				set(strTier0Candidate "${strLibraryRootCandidate}/libtier0.so")
			endif()

			if(NOT EXISTS "${strTier0Candidate}" AND (strArchitecture STREQUAL "x86"))
				set(strTier0Candidate "${strLibraryRootCandidate}/tier0_i486.so")
			endif()
		endif()

		if(EXISTS "${strMathLibraryCandidate}" AND EXISTS "${strTier1Candidate}" AND EXISTS "${strTier0Candidate}")
			set(strLibraryRoot "${strLibraryRootCandidate}")
			break()
		endif()
	endforeach()

	if(NOT strLibraryRoot)
		message(FATAL_ERROR "The selected HL2SDK branch does not contain a complete ${strPlatform}/${strArchitecture} tier0, tier1 and mathlib library set at ${strHL2SDKRoot}.")
	endif()

	if(strPlatform STREQUAL "windows")
		set(vecHL2SDKLibraries "${strTier1Candidate}" "${strMathLibraryCandidate}" "${strTier0Candidate}")
		set(vecHL2SDKSharedLibraries "")
		SourceJSGetExistingPaths(vecOptionalHL2SDKLibraries "${strLibraryRoot}/interfaces.lib" "${strLibraryRoot}/tier2.lib" "${strLibraryRoot}/tier3.lib" "${strLibraryRoot}/vstdlib.lib" "${strLibraryRoot}/vphysics.lib")
	else()
		if(strArchitecture STREQUAL "x86")
			SourceJSPrepareLinuxX86Archive(strTier1Candidate ${strTargetName} "${strHL2SDKRoot}/tier1" "${strTier1Candidate}" tier1
				bitbuf.cpp characterset.cpp checksum_md5.cpp convar.cpp generichash.cpp interface.cpp KeyValues.cpp newbitbuf.cpp strtools.cpp tier1.cpp utlbuffer.cpp utlstring.cpp
			)
			SourceJSPrepareLinuxX86Archive(strMathLibraryCandidate ${strTargetName} "${strHL2SDKRoot}/mathlib" "${strMathLibraryCandidate}" mathlib
				3dnow.cpp color_conversion.cpp mathlib_base.cpp sse.cpp sseconst.cpp vector.cpp vmatrix.cpp
			)
		endif()

		set(vecHL2SDKLibraries "${strTier1Candidate}" "${strMathLibraryCandidate}")
		set(vecHL2SDKSharedLibraries "${strTier0Candidate}")

		if(strArchitecture STREQUAL "x86")
			SourceJSGetExistingPaths(vecOptionalHL2SDKLibraries "${strLibraryRoot}/interfaces_i486.a" "${strLibraryRoot}/interfaces.a" "${strLibraryRoot}/tier2_i486.a" "${strLibraryRoot}/tier3_i486.a" "${strLibraryRoot}/libvstdlib_srv.so" "${strLibraryRoot}/libvstdlib.so" "${strLibraryRoot}/vstdlib_i486.so")
		else()
			SourceJSGetExistingPaths(vecOptionalHL2SDKLibraries "${strLibraryRoot}/interfaces.a" "${strLibraryRoot}/tier2.a" "${strLibraryRoot}/tier3.a" "${strLibraryRoot}/libvstdlib_srv.so" "${strLibraryRoot}/libvstdlib.so")
		endif()
	endif()

	foreach(strOptionalHL2SDKLibrary IN LISTS vecOptionalHL2SDKLibraries)
		if(strOptionalHL2SDKLibrary MATCHES "\\.so$")
			list(APPEND vecHL2SDKSharedLibraries "${strOptionalHL2SDKLibrary}")
		else()
			if((strPlatform STREQUAL "linux") AND (strArchitecture STREQUAL "x86") AND (strOptionalHL2SDKLibrary MATCHES "/interfaces(_i486)?[.]a$"))
				SourceJSPrepareLinuxX86Archive(strOptionalHL2SDKLibrary ${strTargetName} "${strHL2SDKRoot}/interfaces" "${strOptionalHL2SDKLibrary}" interfaces interfaces.cpp)
			endif()

			list(APPEND vecHL2SDKLibraries "${strOptionalHL2SDKLibrary}")
		endif()
	endforeach()

	message(STATUS "Using selected HL2SDK ${strPlatform}/${strArchitecture} libraries from ${strLibraryRoot}")
	target_link_libraries(${strTargetName} PRIVATE ${vecHL2SDKLibraries})

	foreach(strHL2SDKSharedLibrary IN LISTS vecHL2SDKSharedLibraries)
		SourceJSLinkExactSharedLibrary(${strTargetName} "${strHL2SDKSharedLibrary}")
	endforeach()
endfunction()

function(SourceJSReadHL2SDKProtobufSources strOutputVariable strSourceRoot)
	# Use the SDK's own library manifest, not a glob that also includes tests/protoc.
	set(strManifest "${strSourceRoot}/Makefile.am")
	set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${strManifest}")
	file(READ "${strManifest}" strManifestContents)
	string(REPLACE "\r\n" "\n" strManifestContents "${strManifestContents}")
	string(REPLACE "\\\n" " " strManifestContents "${strManifestContents}")
	set(vecProtobufSources "")
	foreach(strLibraryName IN ITEMS libprotobuf_lite libprotobuf)
		string(REGEX MATCH "(^|\n)${strLibraryName}_la_SOURCES =[^\n]+" strSourceAssignment "${strManifestContents}")
		if(NOT strSourceAssignment)
			message(FATAL_ERROR "Missing ${strLibraryName} source list in ${strManifest}.")
		endif()

		string(REGEX MATCHALL "google/protobuf/[A-Za-z0-9_/.-]+\\.cc" vecLibrarySources "${strSourceAssignment}")
		if(NOT vecLibrarySources)
			message(FATAL_ERROR "Empty ${strLibraryName} source list in ${strManifest}.")
		endif()

		foreach(strLibrarySource IN LISTS vecLibrarySources)
			if((strLibrarySource MATCHES "(^|/)\\.\\.(/|$)") OR NOT EXISTS "${strSourceRoot}/${strLibrarySource}")
				message(FATAL_ERROR "Invalid protobuf source ${strLibrarySource} in ${strManifest}.")
			endif()

			list(APPEND vecProtobufSources "${strSourceRoot}/${strLibrarySource}")
		endforeach()
	endforeach()

	list(REMOVE_DUPLICATES vecProtobufSources)
	set(${strOutputVariable} ${vecProtobufSources} PARENT_SCOPE)
endfunction()

function(SourceJSBuildHL2SDKProtobuf25LinuxX86 strTargetName strSourceRoot)
	SourceJSReadHL2SDKProtobufSources(vecProtobufSources "${strSourceRoot}")
	set(strLibraryTarget "${strTargetName}_sdk_protobuf")
	add_library(${strLibraryTarget} STATIC ${vecProtobufSources})
	set_target_properties(${strLibraryTarget} PROPERTIES CXX_STANDARD 11 CXX_STANDARD_REQUIRED ON CXX_EXTENSIONS OFF POSITION_INDEPENDENT_CODE ON)
	target_compile_options(${strLibraryTarget} PRIVATE -m32)
	set(strConfigurationDirectory "${CMAKE_CURRENT_BINARY_DIR}/${strLibraryTarget}_configuration")
	file(GENERATE OUTPUT "${strConfigurationDirectory}/config.h" CONTENT [=[// Generated protobuf 2.5 configuration for the Linux x86 SDK build.
#pragma once

#define HAVE_PTHREAD 1
#define HAVE_HASH_MAP 1
#define HAVE_HASH_SET 1
#define HASH_MAP_H <ext/hash_map>
#define HASH_SET_H <ext/hash_set>
#define HASH_MAP_CLASS hash_map
#define HASH_SET_CLASS hash_set
#define HASH_NAMESPACE __gnu_cxx
#define HAVE_ZLIB 1
]=])
	target_include_directories(${strLibraryTarget} PRIVATE "${strConfigurationDirectory}")
	target_include_directories(${strLibraryTarget} PUBLIC "${strSourceRoot}")
	find_package(Threads REQUIRED)
	find_package(ZLIB REQUIRED)
	target_link_libraries(${strLibraryTarget} PRIVATE Threads::Threads ZLIB::ZLIB)
	target_link_libraries(${strTargetName} PRIVATE ${strLibraryTarget})
endfunction()

function(SourceJSBuildHL2SDKProtobuf strTargetName strSourceRoot strPlatform)
	SourceJSReadHL2SDKProtobufSources(vecProtobufSources "${strSourceRoot}")
	set(strLibraryTarget "${strTargetName}_sdk_protobuf")
	# Reject oversized nested messages before PushLimit clamps away their length.
	set(strCodedStreamSource "${strSourceRoot}/google/protobuf/io/coded_stream.cc")
	set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${strCodedStreamSource}")
	file(READ "${strCodedStreamSource}" strCodedStreamContents)
	set(strUncheckedLimit "  return std::make_pair(PushLimit(byte_limit), --recursion_budget_);")
	string(FIND "${strCodedStreamContents}" "${strUncheckedLimit}" nUncheckedLimitPosition)
	string(FIND "${strCodedStreamContents}" "${strUncheckedLimit}" nLastUncheckedLimitPosition REVERSE)
	if((nUncheckedLimitPosition LESS 0) OR NOT (nUncheckedLimitPosition EQUAL nLastUncheckedLimitPosition))
		message(FATAL_ERROR "Unexpected protobuf nested-message limit implementation in ${strCodedStreamSource}.")
	endif()

	string(CONCAT strCheckedLimit
		"\tif ((byte_limit < 0) || (byte_limit > (current_limit_ - CurrentPosition()))) {\n"
		"\t\treturn std::make_pair(current_limit_, -1);\n"
		"\t}\n"
		"\n"
		"${strUncheckedLimit}"
	)
	string(REPLACE "${strUncheckedLimit}" "${strCheckedLimit}" strCodedStreamContents "${strCodedStreamContents}")
	string(REPLACE "\r\n" "\n" strCodedStreamContents "${strCodedStreamContents}")
	set(strUncheckedMessageEnd "bool CodedInputStream::DecrementRecursionDepthAndPopLimit(Limit limit) {\n  bool result = ConsumedEntireMessage();")
	string(FIND "${strCodedStreamContents}" "${strUncheckedMessageEnd}" nMessageEndPosition)
	string(FIND "${strCodedStreamContents}" "${strUncheckedMessageEnd}" nLastMessageEndPosition REVERSE)
	if((nMessageEndPosition LESS 0) OR NOT (nMessageEndPosition EQUAL nLastMessageEndPosition))
		message(FATAL_ERROR "Unexpected protobuf message completion implementation in ${strCodedStreamSource}.")
	endif()

	set(strCheckedMessageEnd "bool CodedInputStream::DecrementRecursionDepthAndPopLimit(Limit limit) {\n  bool result = ConsumedEntireMessage() && (CurrentPosition() == current_limit_);")
	string(REPLACE "${strUncheckedMessageEnd}" "${strCheckedMessageEnd}" strCodedStreamContents "${strCodedStreamContents}")
	set(strCheckedCodedStreamSource "${CMAKE_CURRENT_BINARY_DIR}/${strLibraryTarget}_compatibility/coded_stream.cc")
	file(GENERATE OUTPUT "${strCheckedCodedStreamSource}" CONTENT "// Generated SDK compatibility source; do not edit.\n${strCodedStreamContents}")
	list(REMOVE_ITEM vecProtobufSources "${strCodedStreamSource}")
	list(APPEND vecProtobufSources "${strCheckedCodedStreamSource}")
	add_library(${strLibraryTarget} STATIC ${vecProtobufSources})
	set_target_properties(${strLibraryTarget} PROPERTIES CXX_STANDARD 11 CXX_STANDARD_REQUIRED ON CXX_EXTENSIONS OFF POSITION_INDEPENDENT_CODE ON MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
	target_include_directories(${strLibraryTarget} PUBLIC "${strSourceRoot}")
	set(strWireHeader "${strSourceRoot}/google/protobuf/wire_format_lite_inl.h")
	set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${strWireHeader}")
	file(READ "${strWireHeader}" strWireHeaderContents)
	set(strUncheckedRead "  io::CodedInputStream::Limit old_limit = input->ReadLengthAndPushLimit();")
	string(FIND "${strWireHeaderContents}" "${strUncheckedRead}" nReadPosition)
	string(FIND "${strWireHeaderContents}" "${strUncheckedRead}" nLastReadPosition REVERSE)
	if((nReadPosition LESS 0) OR NOT (nReadPosition EQUAL nLastReadPosition))
		message(FATAL_ERROR "Unexpected protobuf non-recursive message reader in ${strWireHeader}.")
	endif()

	string(CONCAT strCheckedRead
		"\tint nLength = 0;\n"
		"\tif (!input->ReadVarintSizeAsInt(&nLength)) {\n"
		"\t\treturn false;\n"
		"\t}\n"
		"\n"
		"\tconst int nRemaining = input->BytesUntilLimit();\n"
		"\tif ((nRemaining >= 0) && (nLength > nRemaining)) {\n"
		"\t\treturn false;\n"
		"\t}\n"
		"\n"
		"\tconst int nStart = input->CurrentPosition();\n"
		"\tio::CodedInputStream::Limit old_limit = input->PushLimit(nLength);"
	)
	string(REPLACE "${strUncheckedRead}" "${strCheckedRead}" strWireHeaderContents "${strWireHeaderContents}")
	set(strUncheckedCompletion "  return input->CheckEntireMessageConsumedAndPopLimit(old_limit);")
	string(FIND "${strWireHeaderContents}" "${strUncheckedCompletion}" nCompletionPosition)
	string(FIND "${strWireHeaderContents}" "${strUncheckedCompletion}" nLastCompletionPosition REVERSE)
	if((nCompletionPosition LESS 0) OR NOT (nCompletionPosition EQUAL nLastCompletionPosition))
		message(FATAL_ERROR "Unexpected protobuf non-recursive message completion in ${strWireHeader}.")
	endif()

	string(CONCAT strCheckedCompletion
		"\tconst bool bComplete = (input->CurrentPosition() - nStart) == nLength;\n"
		"\n"
		"\treturn input->CheckEntireMessageConsumedAndPopLimit(old_limit) && bComplete;"
	)
	string(REPLACE "${strUncheckedCompletion}" "${strCheckedCompletion}" strWireHeaderContents "${strWireHeaderContents}")
	set(strCompatibilityRoot "${CMAKE_CURRENT_BINARY_DIR}/${strLibraryTarget}_compatibility")
	file(GENERATE OUTPUT "${strCompatibilityRoot}/google/protobuf/wire_format_lite_inl.h" CONTENT "// Generated SDK compatibility header; do not edit.\n${strWireHeaderContents}")
	target_include_directories(${strLibraryTarget} BEFORE PUBLIC "${strCompatibilityRoot}")
	target_include_directories(${strTargetName} BEFORE PRIVATE "${strCompatibilityRoot}")

	if(MSVC)
		# Modern MSVC no longer exposes hash_compare. Select protobuf's standard
		# hash implementation consistently in the library and its consumers.
		set(strHashHeader "${strSourceRoot}/google/protobuf/stubs/hash.h")
		set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${strHashHeader}")
		file(READ "${strHashHeader}" strHashHeaderContents)
		set(strLegacyHashCondition "#elif defined(_MSC_VER) && !defined(_STLPORT_VERSION)")
		string(REGEX MATCHALL "#elif defined\\(_MSC_VER\\) && !defined\\(_STLPORT_VERSION\\)" vecHashConditions "${strHashHeaderContents}")
		list(LENGTH vecHashConditions unHashConditionCount)
		if(NOT (unHashConditionCount EQUAL 1))
			message(FATAL_ERROR "Unexpected protobuf hash compatibility layout in ${strHashHeader}.")
		endif()

		string(REPLACE "${strLegacyHashCondition}" "${strLegacyHashCondition} && (_MSC_VER < 1900)" strHashHeaderContents "${strHashHeaderContents}")
		set(strCompatibilityRoot "${CMAKE_CURRENT_BINARY_DIR}/${strLibraryTarget}_compatibility")
		file(GENERATE OUTPUT "${strCompatibilityRoot}/google/protobuf/stubs/hash.h" CONTENT "// Generated SDK compatibility header; do not edit.\n${strHashHeaderContents}")
		target_include_directories(${strLibraryTarget} BEFORE PUBLIC "${strCompatibilityRoot}")
		target_include_directories(${strTargetName} BEFORE PRIVATE "${strCompatibilityRoot}")
	endif()

	if(strPlatform STREQUAL "linux")
		find_package(Threads REQUIRED)
		target_compile_definitions(${strLibraryTarget} PRIVATE HAVE_PTHREAD=1)
		target_link_libraries(${strLibraryTarget} PRIVATE Threads::Threads)
	elseif(NOT (strPlatform STREQUAL "windows"))
		message(FATAL_ERROR "Unsupported protobuf source-build platform: ${strPlatform}.")
	endif()

	target_link_libraries(${strTargetName} PRIVATE ${strLibraryTarget})
endfunction()

function(SourceJSLinkHL2SDKProtobuf strTargetName strHL2SDKRoot strPlatform strArchitecture)
	if(NOT (strArchitecture STREQUAL "x86") AND NOT (strArchitecture STREQUAL "x64"))
		message(FATAL_ERROR "Unsupported protobuf architecture: ${strArchitecture}.")
	endif()

	# This SDK ships 3.2 sources/generated messages alongside older binary archives.
	if(EXISTS "${strHL2SDKRoot}/common/protobuf-3.2.0/src/Makefile.am")
		SourceJSBuildHL2SDKProtobuf(${strTargetName} "${strHL2SDKRoot}/common/protobuf-3.2.0/src" "${strPlatform}")
		return()
	endif()

	if((strPlatform STREQUAL "linux") AND (strArchitecture STREQUAL "x86") AND EXISTS "${strHL2SDKRoot}/common/protobuf-2.5.0/src/Makefile.am")
		SourceJSBuildHL2SDKProtobuf25LinuxX86(${strTargetName} "${strHL2SDKRoot}/common/protobuf-2.5.0/src")
		return()
	endif()

	if(strPlatform STREQUAL "windows")
		if(strArchitecture STREQUAL "x64")
			set(vecProtobufCandidates
				"${strHL2SDKRoot}/lib/public/win64/2015/libprotobuf.lib"
				"${strHL2SDKRoot}/lib/win64/release/vs2017/libprotobuf.lib"
				"${strHL2SDKRoot}/lib/win64/release/vs2015/libprotobuf.lib"
			)
		else()
			set(vecProtobufCandidates
				"${strHL2SDKRoot}/lib/win32/release/vs2017/libprotobuf.lib"
				"${strHL2SDKRoot}/lib/win32/release/vs2015/libprotobuf.lib"
				"${strHL2SDKRoot}/lib/win32/release/vs2013/libprotobuf.lib"
			)
		endif()
	elseif(strPlatform STREQUAL "linux")
		if(strArchitecture STREQUAL "x64")
			set(vecProtobufCandidates "${strHL2SDKRoot}/lib/linux64/release/libprotobuf.a")
		else()
			set(vecProtobufCandidates "${strHL2SDKRoot}/lib/linux32/release/libprotobuf.a")
		endif()
	else()
		message(FATAL_ERROR "Unsupported protobuf platform: ${strPlatform}.")
	endif()

	set(strProtobufLibrary "")

	foreach(strProtobufCandidate IN LISTS vecProtobufCandidates)
		if(EXISTS "${strProtobufCandidate}")
			set(strProtobufLibrary "${strProtobufCandidate}")
			break()
		endif()
	endforeach()

	if(NOT strProtobufLibrary)
		message(FATAL_ERROR "The selected protobuf user-message SDK branch does not contain a ${strPlatform}/${strArchitecture} libprotobuf library at ${strHL2SDKRoot}.")
	endif()

	target_link_libraries(${strTargetName} PRIVATE "${strProtobufLibrary}")
endfunction()

function(SourceJSConfigureV8ABI strTargetName strV8Root strV8Configuration)
	set(strV8BuildConfigurationPath "${strV8Root}/out/${strV8Configuration}/v8_build_config.json")
	if(NOT EXISTS "${strV8BuildConfigurationPath}")
		message(FATAL_ERROR "V8 build configuration is required to match the embedder ABI: ${strV8BuildConfigurationPath}.")
	endif()

	file(READ "${strV8BuildConfigurationPath}" strV8BuildConfiguration)
	set(strV8VersionHeader "${strV8Root}/include/v8-version.h")
	set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${strV8BuildConfigurationPath}" "${strV8VersionHeader}")
	file(SHA256 "${strV8BuildConfigurationPath}" strV8BuildHash)
	file(SHA256 "${strV8VersionHeader}" strV8VersionHash)
	string(SHA256 strV8ABI "${strV8BuildHash}:${strV8VersionHash}")
	target_compile_definitions(${strTargetName} PRIVATE SOURCEJS_EXTENSION_V8_ABI="${strV8ABI}")

	set(vecV8Features
		pointer_compression
		pointer_compression_shared_cage
		sandbox
		direct_handle
	)
	set(vecV8Definitions
		V8_COMPRESS_POINTERS
		V8_COMPRESS_POINTERS_IN_SHARED_CAGE
		V8_ENABLE_SANDBOX
		V8_ENABLE_DIRECT_HANDLE
	)
	foreach(strFeature strDefinition IN ZIP_LISTS vecV8Features vecV8Definitions)
		string(JSON strFeatureType ERROR_VARIABLE strFeatureError TYPE "${strV8BuildConfiguration}" "${strFeature}")
		if(NOT strFeatureError STREQUAL "NOTFOUND")
			message(FATAL_ERROR "Cannot read V8 feature ${strFeature} from ${strV8BuildConfigurationPath}: ${strFeatureError}.")
		endif()

		if(NOT strFeatureType STREQUAL "BOOLEAN")
			message(FATAL_ERROR "V8 feature ${strFeature} must be a boolean in ${strV8BuildConfigurationPath}.")
		endif()

		string(JSON bFeatureEnabled GET "${strV8BuildConfiguration}" "${strFeature}")
		if(bFeatureEnabled)
			target_compile_definitions(${strTargetName} PRIVATE "${strDefinition}")
		endif()
	endforeach()
endfunction()

function(SourceJSLinkV8 strTargetName strV8Root strV8Configuration strPlatform)
	if(strPlatform STREQUAL "windows")
		SourceJSGetExistingPaths(vecV8Libraries "${strV8Root}/out/${strV8Configuration}/obj/v8_monolith.lib" "${strV8Root}/out/${strV8Configuration}/v8_monolith.lib")
	elseif(strPlatform STREQUAL "linux")
		SourceJSGetExistingPaths(vecV8Libraries "${strV8Root}/out/${strV8Configuration}/obj/libv8_monolith.a" "${strV8Root}/out/${strV8Configuration}/libv8_monolith.a")
	else()
		message(FATAL_ERROR "Unsupported V8 platform: ${strPlatform}.")
	endif()

	SourceJSRequireNonEmptyList(vecV8Libraries "V8 monolith library for ${strPlatform} configuration ${strV8Configuration} at ${strV8Root}")
	SourceJSConfigureV8ABI(${strTargetName} "${strV8Root}" "${strV8Configuration}")
	list(GET vecV8Libraries 0 strV8Library)
	target_link_libraries(${strTargetName} PRIVATE "$<LINK_LIBRARY:WHOLE_ARCHIVE,${strV8Library}>")
endfunction()

function(SourceJSInstallPackage strTargetName)
	set(strPackageManifestPath "${CMAKE_CURRENT_BINARY_DIR}/package-manifest.json")
	configure_file("${CMAKE_CURRENT_SOURCE_DIR}/packaging/package-manifest.json.in" "${strPackageManifestPath}" @ONLY)

	install(TARGETS ${strTargetName} LIBRARY DESTINATION addons/sourcejs/bin RUNTIME DESTINATION addons/sourcejs/bin)

	install(FILES packaging/sourcejs.vdf DESTINATION addons)
	install(FILES "${strPackageManifestPath}" DESTINATION addons/sourcejs)
	install(DIRECTORY docs/ DESTINATION addons/sourcejs/docs/sourcejs)
	install(DIRECTORY packages/sourcejs/ DESTINATION addons/sourcejs/packages/sourcejs)
	install(DIRECTORY examples/plugins/ DESTINATION addons/sourcejs/plugins)
	install(DIRECTORY packaging/runtime/addons/sourcejs/extensions/ DESTINATION addons/sourcejs/extensions)
	install(DIRECTORY packaging/runtime/addons/sourcejs/bin/ DESTINATION addons/sourcejs/bin)
	install(DIRECTORY packaging/runtime/addons/sourcejs/gamedata/ DESTINATION addons/sourcejs/gamedata
		PATTERN "SourceMod" EXCLUDE
		PATTERN "SourceMod.Pending" EXCLUDE
		PATTERN "SourceMod.Previous" EXCLUDE
		PATTERN "core.games" EXCLUDE
		PATTERN "sdkhooks.games" EXCLUDE
		PATTERN "sdktools.games" EXCLUDE
		PATTERN "sm-cstrike.games" EXCLUDE
		PATTERN "funcommands.games.txt" EXCLUDE
		PATTERN "sm-tf2.games.txt" EXCLUDE
	)
	install(DIRECTORY packaging/runtime/addons/sourcejs/data/ DESTINATION addons/sourcejs/data)
	install(DIRECTORY packaging/runtime/cfg/sourcejs/ DESTINATION cfg/sourcejs)
	install(DIRECTORY packaging/runtime/logs/sourcejs/ DESTINATION logs/sourcejs)
	install(DIRECTORY packaging/runtime/resource/sourcejs/ DESTINATION resource/sourcejs)
	install(DIRECTORY packaging/runtime/sound/sourcejs/ DESTINATION sound/sourcejs)
endfunction()
