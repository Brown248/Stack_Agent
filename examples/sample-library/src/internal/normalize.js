// Internal helper: not part of the public API and free to change between versions.
export function foldAccents(text) {
	return text.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}
