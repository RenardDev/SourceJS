"use strict";

const { writeFileSync } = require("node:fs");
const { join } = require("node:path");

const g_unRIFFPreambleByteCount = 8;
const g_unFormatChunkByteCount = 16;
const g_unPCMFormatTag = 0x0001;
const g_unMonoChannelCount = 1;
const g_unSampleRate = 44_100;
const g_unSampleCount = 2_646;
const g_unSampleByteCount = 2;
const g_unBitsPerSample = 8 * g_unSampleByteCount;
const g_unHeaderByteCount = 44;
const g_unDataByteCount = g_unSampleCount * g_unSampleByteCount;
const g_unAttackSampleCount = 64;
const g_unDecayExponent = 3;
const g_flRadiansPerCycle = 2 * Math.PI;
const g_unFundamentalFrequencyHz = 1_100;
const g_unOvertoneFrequencyHz = 1_900;
const g_flOvertoneWeight = 0.25;
const g_unSampleAmplitude = 7_200;
const g_WaveBuffer = Buffer.alloc(g_unHeaderByteCount + g_unDataByteCount);

// The PCM WAV header uses little-endian numeric fields at fixed byte offsets.
g_WaveBuffer.write("RIFF", 0x00, "ascii");
g_WaveBuffer.writeUInt32LE(g_WaveBuffer.length - g_unRIFFPreambleByteCount, 0x04);
g_WaveBuffer.write("WAVEfmt ", 0x08, "ascii");
g_WaveBuffer.writeUInt32LE(g_unFormatChunkByteCount, 0x10);
g_WaveBuffer.writeUInt16LE(g_unPCMFormatTag, 0x14);
g_WaveBuffer.writeUInt16LE(g_unMonoChannelCount, 0x16);
g_WaveBuffer.writeUInt32LE(g_unSampleRate, 0x18);
g_WaveBuffer.writeUInt32LE(g_unSampleRate * g_unSampleByteCount, 0x1C);
g_WaveBuffer.writeUInt16LE(g_unSampleByteCount, 0x20);
g_WaveBuffer.writeUInt16LE(g_unBitsPerSample, 0x22);
g_WaveBuffer.write("data", 0x24, "ascii");
g_WaveBuffer.writeUInt32LE(g_unDataByteCount, 0x28);

// Synthesize a short, decaying two-tone click after the PCM header.
for (let unSampleIndex = 0; unSampleIndex < g_unSampleCount; ++unSampleIndex) {
	const flTime = unSampleIndex / g_unSampleRate;
	const flEnvelope = Math.min(1, unSampleIndex / g_unAttackSampleCount) * (1 - (unSampleIndex / (g_unSampleCount - 1))) ** g_unDecayExponent;
	const flTone = Math.sin(g_flRadiansPerCycle * g_unFundamentalFrequencyHz * flTime) + (g_flOvertoneWeight * Math.sin(g_flRadiansPerCycle * g_unOvertoneFrequencyHz * flTime));
	const nSample = Math.round(g_unSampleAmplitude * flEnvelope * flTone);
	g_WaveBuffer.writeInt16LE(nSample, g_unHeaderByteCount + (unSampleIndex * g_unSampleByteCount));
}

writeFileSync(join(__dirname, "../packaging/runtime/sound/sourcejs/menu-select.wav"), g_WaveBuffer);
