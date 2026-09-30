import { SmartBuffer } from "smart-buffer";
export const buffers = {
    protocolVersion: function () {
        const writer = SmartBuffer.fromSize(5)
            .writeUInt8(254)
            .writeUInt32LE(23);
        return writer.toBuffer();
    },
    protocolKey: function () {
        const writer = SmartBuffer.fromSize(5)
            .writeUInt8(255)
            .writeUInt32LE(31128);
        return writer.toBuffer();
    },
    spawn: function (name = "XEVBOTS.ϹОᎷ") {
        const writer = new SmartBuffer()
            .writeUInt8(0)
            .writeStringNT(name, 'utf8');
        return writer.toBuffer();
    },
    split: function () {
        return Buffer.from([17]);
    },
    eject: function () {
        return Buffer.from([21]);
    },
    moveTo: function (x, y, key) {
        const writer = SmartBuffer.fromSize(13)
            .writeUInt8(16)
            .writeInt32LE(x)
            .writeInt32LE(y)
            .writeUInt32LE(key);
        return writer.toBuffer();
    },
    sendBotCount: function (data) {
        const writer = new SmartBuffer()
            .writeUInt8(0)
            .writeStringNT(data, 'utf8');
        return writer.toBuffer();
    },
};
