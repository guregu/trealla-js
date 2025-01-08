/** Growable byte buffer. Why isn't this part of the standard library? */
export class ByteBuffer {
	buf: Uint8Array;
	len: number = 0;
	constructor(cap = 1024) {
		this.buf = new Uint8Array(cap);
	}
	get cap() {
		return this.buf.byteLength;
	}
	get data() {
		return this.buf.slice(0, this.len);
	}
	toString() {
		return this.len ? new TextDecoder().decode(this.data) : "";
	}
	write(data: Uint8Array) {
		this.grow(this.len + data.byteLength);
		this.buf.set(data, this.len);
		this.len += data.byteLength;
	}
	copyFrom(other: ByteBuffer) {
		this.write(other.data);
	}
	grow(size: number) {
		if (this.cap >= size)
			return;
		const cap2 = Math.max(size, this.cap * 2);
		const buf2 = new Uint8Array(cap2);
		buf2.set(this.buf, 0);
		this.buf = buf2;
	}
	reset() {
		this.len = 0;
	}
}
