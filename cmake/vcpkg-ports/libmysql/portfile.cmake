if(EXISTS "${CURRENT_INSTALLED_DIR}/include/mysql/mysql.h")
	message(FATAL_ERROR "${PORT} and libmariadb are incompatible.")
endif()

vcpkg_from_github(
	OUT_SOURCE_PATH SOURCE_PATH
	REPO mysql/mysql-server
	REF "mysql-${VERSION}"
	SHA512 68e42702c3f99eb92f695d4d26cfbd7b07c0b8cfaa07f23d8aad5d7271fadf8d619679fcde821296c6dbc6b14b0c5637b31b5ec91eb414cfc5e19339bfdf6e07
	HEAD_REF master
	PATCHES
		dependencies.patch
		install-exports.patch
		fix_dup_symbols.patch
		cross-build.patch
		fix-pdb-install-path.patch
		sourcejs-global-dynamic-tls.patch
)

file(GLOB vecThirdPartyPaths "${SOURCE_PATH}/extra/*" "${SOURCE_PATH}/include/boost_1_*")
list(REMOVE_ITEM vecThirdPartyPaths "${SOURCE_PATH}/extra/libedit" "${SOURCE_PATH}/extra/unordered_dense" "${SOURCE_PATH}/extra/xxhash")
if(vecThirdPartyPaths)
	file(REMOVE_RECURSE ${vecThirdPartyPaths})
endif()

# Skip the version check for Visual Studio.
set(bForceUnsupportedCompiler FALSE)
if(VCPKG_TARGET_IS_WINDOWS)
	set(bForceUnsupportedCompiler TRUE)
endif()

string(COMPARE EQUAL "${VCPKG_LIBRARY_LINKAGE}" "static" bBuildStaticLibraries)
string(COMPARE EQUAL "${VCPKG_CRT_LINKAGE}" "static" bStaticCRTLinkage)

set(vecCrossOptions "")
if(VCPKG_CROSSCOMPILING)
	list(APPEND vecCrossOptions
		-DCMAKE_CROSSCOMPILING=1
		-DVCPKG_HOST_TRIPLET=${HOST_TRIPLET}
		# Required to skip try_run.
		-DHAVE_RAPIDJSON_WITH_STD_REGEX=1
	)

	if(NOT VCPKG_TARGET_IS_WINDOWS)
		list(APPEND vecCrossOptions
			# Optimistic values to skip try_run.
			-DHAVE_CLOCK_GETTIME=1
			-DHAVE_CLOCK_REALTIME=1
			# Pessimistic values to skip try_run.
			-DHAVE_C_FLOATING_POINT_FUSED_MADD=1
			-DHAVE_CXX_FLOATING_POINT_FUSED_MADD=1
			-DHAVE_SETNS=0
		)
	endif()
endif()

vcpkg_cmake_configure(
	SOURCE_PATH "${SOURCE_PATH}"
	OPTIONS
		${vecCrossOptions}
		-DINSTALL_INCLUDEDIR=include/mysql
		-DINSTALL_DOCDIR=share/${PORT}/doc
		-DINSTALL_MANDIR=share/${PORT}/doc
		-DINSTALL_INFODIR=share/${PORT}/doc
		-DINSTALL_DOCREADMEDIR=share/${PORT}
		-DINSTALL_SHAREDIR=share
		-DINSTALL_MYSQLSHAREDIR=share/${PORT}
		-DWITHOUT_SERVER=ON
		-DWITH_BUILD_ID=OFF
		-DWITH_UNIT_TESTS=OFF
		-DENABLED_PROFILING=OFF
		-DWIX_DIR=OFF
		-DIGNORE_BOOST_VERSION=ON
		-DWITH_TEST_TRACE_PLUGIN=OFF
		-DMYSQL_MAINTAINER_MODE=OFF
		-DBUNDLE_RUNTIME_LIBRARIES=OFF
		-DCURSES_NEED_WIDE=ON
		-DDOWNLOAD_BOOST=OFF
		-DWITH_AUTHENTICATION_KERBEROS=OFF
		-DWITH_AUTHENTICATION_LDAP_DEFAULT=OFF
		-DWITH_CURL=none
		-DWITH_EDITLINE=bundled
		-DWITH_LZ4=system
		-DWITH_RAPIDJSON=system
		-DWITH_SSL=system
		-DWITH_SYSTEMD=OFF
		-DWITH_ZLIB=system
		-DWITH_ZSTD=system
		-DFORCE_UNSUPPORTED_COMPILER=${bForceUnsupportedCompiler}
		-DINSTALL_STATIC_LIBRARIES=${bBuildStaticLibraries}
		-DLINK_STATIC_RUNTIME_LIBRARIES=${bStaticCRTLinkage}
		-DWITH_EXT_BACKTRACE=OFF
	MAYBE_UNUSED_VARIABLES
		BUNDLE_RUNTIME_LIBRARIES # Windows only.
		LINK_STATIC_RUNTIME_LIBRARIES # Windows only.
		WIX_DIR # Windows only.
		WITH_BUILD_ID # Linux, except Alpine, only.
)

vcpkg_cmake_install(ADD_BIN_TO_PATH)
vcpkg_copy_pdbs()
vcpkg_cmake_config_fixup(PACKAGE_NAME unofficial-libmysql)
vcpkg_fixup_pkgconfig()

set(vecMySQLTools
	my_print_defaults
	mysql
	mysql_config_editor
	mysql_migrate_keyring
	mysql_secure_installation
	mysql_ssl_rsa_setup
	mysqladmin
	mysqlbinlog
	mysqlcheck
	mysqldump
	mysqlimport
	mysqlpump
	mysqlshow
	mysqlslap
	mysqltest
	perror
	zlib_decompress
)

if(NOT VCPKG_CROSSCOMPILING)
	list(APPEND vecMySQLTools comp_err)
endif()

if(VCPKG_TARGET_IS_WINDOWS)
	list(APPEND vecMySQLTools echo)
else()
	list(APPEND vecMySQLTools mysql_config)
endif()

vcpkg_copy_tools(TOOL_NAMES ${vecMySQLTools} AUTO_CLEAN)

file(REMOVE_RECURSE "${CURRENT_PACKAGES_DIR}/debug/include" "${CURRENT_PACKAGES_DIR}/debug/share" "${CURRENT_PACKAGES_DIR}/lib/debug")

if(NOT VCPKG_TARGET_IS_WINDOWS)
	set(strMySQLConfigurationFile "${CURRENT_PACKAGES_DIR}/tools/libmysql/mysql_config")
	vcpkg_replace_string("${strMySQLConfigurationFile}" "/bin/mysql_.*config" "/tools/libmysql/mysql_.*config")
	vcpkg_replace_string("${strMySQLConfigurationFile}" "'${CURRENT_PACKAGES_DIR}" "\"\$basedir\"\'")
endif()

file(INSTALL "${CURRENT_PORT_DIR}/usage" DESTINATION "${CURRENT_PACKAGES_DIR}/share/${PORT}")

set(strLibEditCopying "${SOURCE_PATH}/COPYING for libedit")
file(GLOB vecLibEditCopyingInputFiles "${SOURCE_PATH}/extra/libedit/libedit-*/COPYING")
list(LENGTH vecLibEditCopyingInputFiles unLibEditCopyingInputCount)
if(NOT unLibEditCopyingInputCount EQUAL 1)
	message(FATAL_ERROR "Expected exactly one libedit COPYING file under ${SOURCE_PATH}/extra/libedit; found ${unLibEditCopyingInputCount}.")
endif()

list(GET vecLibEditCopyingInputFiles 0 strLibEditCopyingInputFile)
file(COPY_FILE "${strLibEditCopyingInputFile}" "${strLibEditCopying}")
vcpkg_install_copyright(FILE_LIST "${SOURCE_PATH}/LICENSE" "${strLibEditCopying}")
