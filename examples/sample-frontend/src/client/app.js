import { splitBill } from "../shared/format.js";

const form = document.getElementById("split");
const share = document.getElementById("share");

function render() {
	const data = new FormData(form);
	try {
		share.value = splitBill(Number(data.get("total")), Number(data.get("people")), Number(data.get("tip")));
	} catch (err) {
		share.value = err.message;
	}
}

form.addEventListener("input", render);
render();
