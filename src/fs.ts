import { ConsoleStdout, OpenFile, PreopenDirectory, wasi, File as WASIFile } from "@bjorn3/browser_wasi_shim";

export class FS {
	os;
	constructor(os: OS) {
		this.os = os;
	}

	readDir(path: string): Array<any> {
		path = fixPath(path);
		return []; // TODO
	}
	createDir(path: string) {
		path = fixPath(path);
		const { ret } = this.os.root.dir.create_entry_for_path(path, true);
		if (ret !== 0) {
			throw new Error(`wasi error: ${ret}`); // TODO
		}
	}
	removeDir(path: string) {
		path = fixPath(path);
		const ret = this.os.root.path_remove_directory(path);
		if (ret !== 0) {
			throw new Error(`wasi error: ${ret}`); // TODO
		}
	}
	removeFile(path: string) {
		path = fixPath(path);
		// const ret = this.os.root.dir.get_parent_dir_and_entry_for_path(path, false);
		const ok = this.os.root.dir.contents.delete(path);
		// TODO: should this throw?
	}
	rename(path: string, to: string) {
		path = fixPath(path);
		const file = this.os.root.dir.contents.get(path);
		if (!file) {
			throw new Error(`no such file: ${path}`);
		}
		this.os.root.dir.contents.delete(path);
		this.os.root.dir.contents.set(to, file);
		// TODO call wasi instead
	}
	metadata(path: string) {
		path = fixPath(path);
		const file = this.os.root.dir.contents.get(path);
		if (!file) {
			return null;
		}
		return file.stat();
	}
	open(path: string, options: {create?: boolean, write?: boolean}) {
		path = fixPath(path);
		if (options.create) {
			const { ret, entry } = this.os.root.dir.create_entry_for_path(path, false);
			if (ret !== 0) throw new Error(`wasi error: ${ret}`);
			return new File(entry as WASIFile); // TODO
		}
		const {ret, fd_obj } = this.os.root.path_open(0, path, 0, BigInt(wasi.RIGHTS_FD_WRITE), BigInt(wasi.RIGHTS_FD_WRITE), 0);
		if (ret !== 0) throw new Error(`wasi error: ${ret}`);
		// TODO
		return new File((fd_obj as OpenFile).file);
	}
}

function fixPath(path: string): string {
	if (!path)
		return "";
	if (path[0] === "/")
		return path.slice(1);
	return path;
}

export class File {
	entity: WASIFile;
	constructor(f: WASIFile) {
		this.entity = f;
	}

	lastAccessed(): bigint { return BigInt(0) }
	lastModified(): bigint { return BigInt(0) }
	createdTime(): bigint { return BigInt(0) }
	size(): bigint {
		return this.entity.stat().size;
	}
	setLength(new_size: BigInt): void {
		// if (this.entity.fd_allocate) {
		// 	const ret = this.entity.fd_allocate(new_size, 0);
		// 	if (ret !== 0) throw new Error(`wasi error: ${ret}`);
		// }
	}
	read(): Uint8Array {
		return this.entity.data;
		this.entity;
	}
	readString(): string {
		return new TextDecoder().decode(this.entity.data);
	}
	write(buf: Uint8Array): number {
		this.entity.data = buf;
		return buf.byteLength;
	}
	writeString(buf: string): number {
		this.entity.data = new TextEncoder().encode(buf);
		return this.entity.data.byteLength;
	}
	flush(): void {}
	seek(position: number): number {
		return 0;
	}
}

export type OS = {
	stdout: OutputStream;
	stderr: OutputStream;
	//oob: 	OutputStream;
	tmp: 	PreopenDirectory;
	root: 	PreopenDirectory;
}

export function newOS(): OS {
	return {
		stdout: new OutputStream(),
		stderr: new OutputStream(),
		//oob: 	new OutputStream(),
		tmp: 	new PreopenDirectory("/tmp", new Map()),
		root: 	new PreopenDirectory(".", new Map()),
	};
}

class OutputStream {
	bufs: Uint8Array[] = [];
	fd: ConsoleStdout;
	constructor() {
		this.fd = new ConsoleStdout((buf) => {
			if (buf.length > 0)
				this.bufs.push(buf);
		});
	}
	join(): Uint8Array {
		return joinBuffers(this.bufs);
	}
	reset(): void {
		// TODO: re-use buffers?
		this.bufs = [];
	}
}


function joinBuffers(bufs: Uint8Array[]) {
	if (bufs.length === 0) {
		return new Uint8Array(0);
	}
	if (bufs.length === 1) {
		return bufs[0];
	}
	let size = 0;
	for (const buf of bufs) {
		size += buf.length;
	}
	const ret = new Uint8Array(size);
	let i = 0;
	for (const buf of bufs) {
		ret.set(buf, i);
		i += buf.length;
	}
	return ret;
}
