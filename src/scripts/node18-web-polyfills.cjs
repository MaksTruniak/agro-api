const { Blob, File } = require('node:buffer')
const { ReadableStream, TransformStream } = require('node:stream/web')

if (typeof globalThis.Blob === 'undefined') {
  globalThis.Blob = Blob
}

if (typeof globalThis.File === 'undefined') {
  globalThis.File = File
}

if (typeof globalThis.ReadableStream === 'undefined') {
  globalThis.ReadableStream = ReadableStream
}

if (typeof globalThis.TransformStream === 'undefined') {
  globalThis.TransformStream = TransformStream
}

if (typeof globalThis.DOMException === 'undefined') {
  globalThis.DOMException = class DOMException extends Error {
    constructor(message = '', name = 'Error') {
      super(message)
      this.name = name
    }
  }
}

if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class WebSocket {}
}
