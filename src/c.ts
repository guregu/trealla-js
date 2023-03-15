export const PTRSIZE: size_t = 4;
export const ALIGN: int_t = 1;
export const NULL: Ptr<any> = 0;
export const FALSE: bool_t = 0;
export const TRUE: bool_t = 1;

export type Ptr<_> = number;
export type char_t = void;
export type void_t = void;
export type size_t = number;
export type int_t = number;
export type bool_t = 0 | 1;

export interface WASI extends WebAssembly.Instance {
	exports: ABI;
}

export interface ABI extends WebAssembly.Exports {
	memory: WebAssembly.Memory;
	canonical_abi_realloc<T>(ptr: Ptr<T>, old_size: size_t, align: int_t, size: size_t): Ptr<T>;
	canonical_abi_free<T>(ptr: Ptr<T>, size: size_t, align: int_t): void;
}

export class CString {
	instance;
	ptr: Ptr<char_t>;
	size;

	constructor(instance: WASI, text: string) {
		this.instance = instance;
		const realloc = instance.exports.canonical_abi_realloc;

		const buf = new TextEncoder().encode(text);
		this.size = buf.byteLength + 1;

		this.ptr = realloc<char_t>(NULL, 0, ALIGN, this.size);
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

export function readString(instance: WASI, ptr: Ptr<char_t>, size?: number) {
	const mem = new Uint8Array(instance.exports.memory.buffer);
	const idx = size ? ptr+size : mem.indexOf(0, ptr);
	if (idx === -1) {
		throw new Error(`unterminated string at address ${ptr}`)
	}
	return new TextDecoder().decode(mem.subarray(ptr, idx));
}

export function indirect<T extends number>(instance: WASI, addr: Ptr<T>): T | typeof NULL {
	if (addr === NULL) return NULL;
	return (new Uint32Array(instance.exports.memory.buffer))[addr / 4];
}

export function writeUint32<T>(instance: WASI, addr: Ptr<T>, int: number) {
	new Uint32Array(instance.exports.memory.buffer)[addr / 4] = int;
}
