"use strict";

const { createSocket } = require("node:dgram");
const { createServer } = require("node:net");
const { setTimeout: Wait } = require("node:timers/promises");

// Source A2S_INFO starts with an out-of-band marker and the query type byte.
const g_Query = Buffer.concat([Buffer.from([0xFF, 0xFF, 0xFF, 0xFF, 0x54]), Buffer.from("Source Engine Query\0")]);
const g_unResponseTypeOffset = 0x04;
const g_unResponseHeaderByteCount = g_unResponseTypeOffset + 1;
const g_unChallengeResponseByteCount = g_unResponseHeaderByteCount + 4;
const g_unChallengeResponseType = 0x41;
const g_unInformationResponseType = 0x49;
const g_unGamePort = 27362;
const g_unClockPort = 27352;
const g_strLoopbackAddress = "127.0.0.1";
const g_strTestAddress = "127.0.0.2";
const g_unQueryTimeoutMilliseconds = 1_000;
const g_unClockIntervalMilliseconds = 180;
const g_unBeforeProbeDelayMilliseconds = 10_000;
const g_unAfterProbeDelayMilliseconds = 62_000;
const g_unProbeLifetimeMilliseconds = 110_000;

function QueryServer(strLocalAddress) {
	return new Promise((Resolve, Reject) => {
		const Socket = createSocket("udp4");
		let bChallenged = false;

		function Finish(strResult) {
			clearTimeout(QueryTimeout);
			Socket.close();
			Resolve(strResult);
		}

		const QueryTimeout = setTimeout(() => Finish("no-response"), g_unQueryTimeoutMilliseconds);
		Socket.once("error", (Failure) => {
			clearTimeout(QueryTimeout);
			Socket.close();
			Reject(Failure);
		});

		Socket.on("message", (Packet) => {
			if ((Packet.length >= g_unChallengeResponseByteCount) && (Packet[g_unResponseTypeOffset] === g_unChallengeResponseType) && !bChallenged) {
				bChallenged = true;
				Socket.send(Buffer.concat([g_Query, Packet.subarray(g_unResponseHeaderByteCount, g_unChallengeResponseByteCount)]), g_unGamePort, g_strLoopbackAddress);
				return;
			}

			Finish(((Packet.length >= g_unResponseHeaderByteCount) && (Packet[g_unResponseTypeOffset] === g_unInformationResponseType)) ? "info" : "other-response");
		});

		Socket.bind(0, strLocalAddress, () => Socket.send(g_Query, g_unGamePort, g_strLoopbackAddress));
	});
}

async function CheckPhase(strPhase) {
	const [strControl, strTest] = await Promise.all([QueryServer(g_strLoopbackAddress), QueryServer(g_strTestAddress)]);
	console.log(`IP ban expiry query: ${strPhase} Control=${strControl} Test=${strTest}`);
}

const g_ClockServer = createServer((Connection) => {
	const Timer = setInterval(() => Connection.write(Buffer.from([0x01])), g_unClockIntervalMilliseconds);
	Connection.on("error", () => {});
	Connection.on("close", () => clearInterval(Timer));

	(async () => {
		await Wait(g_unBeforeProbeDelayMilliseconds);
		await CheckPhase("before");
		await Wait(g_unAfterProbeDelayMilliseconds);
		await CheckPhase("after");
	})().catch((Failure) => console.error(Failure));
});

g_ClockServer.listen(g_unClockPort, g_strLoopbackAddress);
setTimeout(() => process.exit(0), g_unProbeLifetimeMilliseconds);
