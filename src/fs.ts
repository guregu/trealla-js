import { ConsoleStdout, Directory, PreopenDirectory,
		OpenFile, File as WASIFile, Path,
		WASI, wasi } from "@guregu/browser_wasi_shim";

export class FS {
	os;
	wasi;
	constructor(wasi: WASI, os: OS) {
		this.wasi = wasi;
		this.os = os;
	}

	readDir(name: string): Array<any> {
		const { path } = Path.from(fixPath(name));
		if (!path)
			throw new Error("directory not found: " + name);
		const { ret, entry } = this.os.root.dir.get_entry_for_path(path);
		if (ret !== 0)
			throw wasiError(ret, name);
		if (!(entry instanceof Directory))
			throw new Error(`not a directory: ${name}`);
		return Array.from(entry.contents.keys());
	}

	createDir(path: string) {
		path = fixPath(path);
		const { ret } = this.os.root.dir.create_entry_for_path(path, true);
		if (ret !== 0) {
			throw wasiError(ret, path);
		}
	}

	removeDir(path: string) {
		path = fixPath(path);
		const ret = this.os.root.path_remove_directory(path);
		if (ret !== 0) {
			throw wasiError(ret, path);
		}
	}

	removeFile(name: string) {
		name = fixPath(name);
		const { path } = Path.from(name);
		if (path === null) {
			throw new Error(`invalid path? ${name}`); // TODO
		}
		const { ret, parent_entry, filename } = this.os.root.dir.get_parent_dir_and_entry_for_path(path, false);
		if (ret !== 0) {
			throw wasiError(ret, name);
		}
		const parent = parent_entry ?? this.os.root.dir;
		parent.contents.delete(filename ?? name);
	}

	rename(path: string, to: string) {
		path = fixPath(path);
		to = fixPath(to);
		const fd = this.wasi.fds.indexOf(this.os.root);
		const ret = this.os.root.path_rename(path, fd, to);
		if (ret !== 0) {
			throw wasiError(ret, `rename(${path}, ${to})`);
		}
	}

	metadata(path: string) {
		path = fixPath(path);
		const { ret, filestat } = this.os.root.path_filestat_get(0, path);
		if (ret !== 0) {
			throw wasiError(ret, path);
		}
		return filestat;
	}

	open(path: string, options: {create?: boolean, write?: boolean}) {
		path = fixPath(path);
		if (options.create) {
			const { ret, entry } = this.os.root.dir.create_entry_for_path(path, false);
			if (ret !== 0) throw wasiError(ret, path);
			return new File(entry as WASIFile); // TODO
		}
		const rights = !!options?.write ? BigInt(wasi.RIGHTS_FD_WRITE) : BigInt(0);
		const { ret, fd_obj } = this.os.root.path_open(0, path, 0, rights, rights, 0);
		if (ret !== 0) throw wasiError(ret);
		// TODO
		return new File((fd_obj as OpenFile).file);
	}
}

function wasiError(errno: number, context = "WASI error") {
	let desc = strerror[errno] ?? String(errno);
	return new Error(`${context}: ${desc}`);
}

const strerror: Record<number, string> = {
	[wasi.ERRNO_PERM]:				"EPERM",
	[wasi.ERRNO_NOENT]:				"ENOENT",
	[wasi.ERRNO_SRCH]:				"ESRCH",
	[wasi.ERRNO_INTR]:				"EINTR",
	[wasi.ERRNO_IO]:				"EIO",
	[wasi.ERRNO_NXIO]:				"ENXIO",
	[wasi.ERRNO_2BIG]:				"E2BIG",
	[wasi.ERRNO_NOEXEC]:			"ENOEXEC",
	[wasi.ERRNO_BADF]:				"EBADF",
	[wasi.ERRNO_CHILD]:				"ECHILD",
	[wasi.ERRNO_AGAIN]:				"EAGAIN",
	[wasi.ERRNO_NOMEM]:				"ENOMEM",
	[wasi.ERRNO_ACCES]:				"EACCES",
	[wasi.ERRNO_FAULT]:				"EFAULT",
	[wasi.ERRNO_BUSY]:				"EBUSY",
	[wasi.ERRNO_EXIST]:				"EEXIST",
	[wasi.ERRNO_XDEV]:				"EXDEV",
	[wasi.ERRNO_NODEV]:				"ENODEV",
	[wasi.ERRNO_NOTDIR]:			"ENOTDIR",
	[wasi.ERRNO_ISDIR]:				"EISDIR",
	[wasi.ERRNO_INVAL]:				"EINVAL",
	[wasi.ERRNO_NFILE]:				"ENFILE",
	[wasi.ERRNO_MFILE]:				"EMFILE",
	[wasi.ERRNO_NOTTY]:				"ENOTTY",
	[wasi.ERRNO_TXTBSY]:			"ETXTBSY",
	[wasi.ERRNO_FBIG]:				"EFBIG",
	[wasi.ERRNO_NOSPC]:				"ENOSPC",
	[wasi.ERRNO_SPIPE]:				"ESPIPE",
	[wasi.ERRNO_ROFS]:				"EROFS",
	[wasi.ERRNO_MLINK]:				"EMLINK",
	[wasi.ERRNO_PIPE]:				"EPIPE",
	[wasi.ERRNO_DOM]:				"EDOM",
	[wasi.ERRNO_RANGE]:				"ERANGE",
	[wasi.ERRNO_DEADLK]:			"EDEADLK",
	[wasi.ERRNO_NAMETOOLONG]:		"ENAMETOOLONG",
	[wasi.ERRNO_NOLCK]:				"ENOLCK",
	[wasi.ERRNO_NOSYS]:				"ENOSYS",
	[wasi.ERRNO_NOTEMPTY]:			"ENOTEMPTY",
	[wasi.ERRNO_LOOP]:				"ELOOP",
	[wasi.ERRNO_NOMSG]:				"ENOMSG",
	[wasi.ERRNO_IDRM]:				"EIDRM",
	[wasi.ERRNO_NOLINK]:			"ENOLINK",
	[wasi.ERRNO_PROTO]:				"EPROTO",
	[wasi.ERRNO_MULTIHOP]:			"EMULTIHOP",
	[wasi.ERRNO_BADMSG]:			"EBADMSG",
	[wasi.ERRNO_OVERFLOW]:			"EOVERFLOW",
	[wasi.ERRNO_ILSEQ]:				"EILSEQ",
	[wasi.ERRNO_NOTSOCK]:			"ENOTSOCK",
	[wasi.ERRNO_DESTADDRREQ]:		"EDESTADDRREQ",
	[wasi.ERRNO_MSGSIZE]:			"EMSGSIZE",
	[wasi.ERRNO_PROTOTYPE]:			"EPROTOTYPE",
	[wasi.ERRNO_NOPROTOOPT]:		"ENOPROTOOPT",
	[wasi.ERRNO_PROTONOSUPPORT]:	"EPROTONOSUPPORT",
	[wasi.ERRNO_NOTSUP]:			"ENOTSUP",
	[wasi.ERRNO_AFNOSUPPORT]:		"EAFNOSUPPORT",
	[wasi.ERRNO_ADDRINUSE]:			"EADDRINUSE",
	[wasi.ERRNO_ADDRNOTAVAIL]:		"EADDRNOTAVAIL",
	[wasi.ERRNO_NETDOWN]:			"ENETDOWN",
	[wasi.ERRNO_NETUNREACH]:		"ENETUNREACH",
	[wasi.ERRNO_NETRESET]:			"ENETRESET",
	[wasi.ERRNO_CONNABORTED]:		"ECONNABORTED",
	[wasi.ERRNO_CONNRESET]:			"ECONNRESET",
	[wasi.ERRNO_NOBUFS]:			"ENOBUFS",
	[wasi.ERRNO_ISCONN]:			"EISCONN",
	[wasi.ERRNO_NOTCONN]:			"ENOTCONN",
	[wasi.ERRNO_TIMEDOUT]:			"ETIMEDOUT",
	[wasi.ERRNO_CONNREFUSED]:		"ECONNREFUSED",
	[wasi.ERRNO_HOSTUNREACH]:		"EHOSTUNREACH",
	[wasi.ERRNO_ALREADY]:			"EALREADY",
	[wasi.ERRNO_INPROGRESS]:		"EINPROGRESS",
	[wasi.ERRNO_STALE]:				"ESTALE",
	[wasi.ERRNO_DQUOT]:				"EDQUOT",
	[wasi.ERRNO_CANCELED]:			"ECANCELED",
	[wasi.ERRNO_OWNERDEAD]:			"EOWNERDEAD",
	[wasi.ERRNO_NOTRECOVERABLE]:	"ENOTRECOVERABLE",
};

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
		// 	if (ret !== 0) throw wasiError(ret);
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
