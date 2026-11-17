
// General
#if defined(_WIN32)
#include <winsock2.h>
#include <ws2tcpip.h>
#include <Windows.h>
#else
#include <fcntl.h>
#include <netdb.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>
#endif

// C++
#include <cerrno>
#include <cstdint>
#include <cstdio>

// STL
#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <latch>
#include <limits>
#include <memory>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <thread>

namespace {
@SOCKET_CORE@
	void Require(const bool bCondition, char const* const pszMessage) {
		if (!bCondition) {
			throw std::runtime_error(pszMessage);
		}
	}

	std::size_t Receive(SocketConnectionRecord& Connection, char* const pchBytes, const std::size_t unByteCount, SocketRequest const& Request) {
		SocketConnectionOperation Operation = Connection;
		std::unique_lock<std::timed_mutex> Lock = LockSocketDirection(Connection.m_ReceiveMutex, Request);
#if defined(_WIN32)
		WSABUF Buffer {};
		Buffer.buf = pchBytes;
		Buffer.len = static_cast<ULONG>(unByteCount);
		return TransferNativeSocketBuffer(Connection, Operation.m_hSocket, Buffer, true, Request);
#else
		return TransferNativeSocketBytes(Operation.m_hSocket, nullptr, pchBytes, unByteCount, Request);
#endif
	}

	void RunSocketChecks() {
		SocketConnectionRecord Listener {};
#if defined(_WIN32)
		WSADATA WinsockData {};
		Require(WSAStartup(MAKEWORD(2, 2), &WinsockData) == 0, "WSAStartup failed");
		Listener.m_bWinsockInitialized = true;
#endif
		Listener.m_hSocket = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
		Require(Listener.m_hSocket != kInvalidNativeSocketHandle, "listener socket failed");
		sockaddr_in Address {};
		Address.sin_family = AF_INET;
		Address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
		Require(bind(Listener.m_hSocket, reinterpret_cast<sockaddr*>(&Address), sizeof(Address)) == 0, "loopback bind failed");
		Require(listen(Listener.m_hSocket, 1) == 0, "loopback listen failed");
		NativeSocketLength nAddressLength = sizeof(Address);
		Require(getsockname(Listener.m_hSocket, reinterpret_cast<sockaddr*>(&Address), &nAddressLength) == 0, "getsockname failed");

		SocketConnectionRecord Connection {};
		SocketRequest ConnectRequest("fixture", 2000);
		ConnectNativeSocket(Connection, "127.0.0.1", ntohs(Address.sin_port), ConnectRequest);
		Require(!ConnectRequest.Cancel(), "a connected request cannot be cancelled");
		SocketConnectionRecord Peer {};
		Peer.m_hSocket = accept(Listener.m_hSocket, nullptr, nullptr);
		Require(Peer.m_hSocket != kInvalidNativeSocketHandle, "accept failed");

		char arrBytes[2] {};
		SocketRequest TimeoutRequest("fixture", 60);
		bool bTimedOut = false;
		try {
			Receive(Connection, arrBytes, sizeof(arrBytes), TimeoutRequest);
		} catch (std::runtime_error const& Error) {
			bTimedOut = std::string_view(Error.what()).find("timed out") != std::string_view::npos;
		}

		Require(bTimedOut, "an idle read did not time out");
		SocketRequest CancelRequest("fixture", 0);
		std::latch Started(1);
		bool bCancelled = false;
		std::jthread Worker([&] {
			Started.count_down();
			try {
				Receive(Connection, arrBytes, sizeof(arrBytes), CancelRequest);
			} catch (std::runtime_error const& Error) {
				bCancelled = std::string_view(Error.what()).find("cancelled") != std::string_view::npos;
			}
		});
		Started.wait();
		std::this_thread::sleep_for(std::chrono::milliseconds(60));
		Require(CancelRequest.Cancel(), "pending read did not accept cancellation");
		Worker.join();
		Require(bCancelled && !CancelRequest.Cancel(), "read did not observe a single cancellation");

		constexpr char kByte = 'Z';
		Require(send(Peer.m_hSocket, &kByte, 1, 0) == 1, "loopback send failed");
		SocketRequest VerifyRequest("fixture", 2000);
		Require((Receive(Connection, arrBytes, sizeof(arrBytes), VerifyRequest) == 1) && (arrBytes[0] == kByte), "connection was not reusable after timeout/cancellation");
		Require(CloseSocketConnection(Connection), "close failed");
	}
} // namespace

int main() try {
	RunSocketChecks();
	std::puts("Native loopback socket timeout, cancellation, and connection reuse passed.");
	return 0;
} catch (std::exception const& Error) {
	std::fputs(Error.what(), stderr);
	return 1;
}
