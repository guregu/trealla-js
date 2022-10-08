export const PTRSIZE = 4;
export const ALIGN = 1;
export const NULL = 0;
export const FALSE = 0;
export const TRUE = 1;

export class CString {
	instance;
	ptr;
	size;

	constructor(instance, text) {
		this.instance = instance;
		const realloc = instance.exports.canonical_abi_realloc;

		const buf = new TextEncoder().encode(text);
		this.size = buf.byteLength + 1;

		this.ptr = realloc(NULL, 0, ALIGN, this.size);
		if (this.ptr === NULL) {
			throw new Error("could not allocate cstring: " + text);
		}

		try {
			const mem = new Uint8Array(instance.exports.memory.buffer, this.ptr, this.size);
			mem.set(buf);
			mem[buf.byteLength] = 0;
		} catch (err) {
			this.free();
			throw err;
		}
	}

	free() {
		if (this.ptr === NULL) {
			return;
		}
		const free = this.instance.exports.canonical_abi_free;
		free(this.ptr, this.size, ALIGN);
		this.ptr = NULL;
		this.size = 0;
	}
}

export function readString(instance, ptr, size) {
	const mem = new Uint8Array(instance.exports.memory.buffer);
	const idx = size ? ptr+size : mem.indexOf(0, ptr);
	if (idx === -1) {
		throw new Error(`unterminated string at address ${ptr}`)
	}
	return new TextDecoder().decode(mem.subarray(ptr, idx));
}

export function indirect(instance, addr) {
	if (addr === NULL) return NULL;
	return (new Uint32Array(instance.exports.memory.buffer))[addr / 4];
}

export function writeUint32(instance, addr, int) {
	new Uint32Array(instance.exports.memory.buffer)[addr / 4] = int;
}