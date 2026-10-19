// Shared by the browser and Node: no DOM, no node: imports.
export function splitBill(total, people, tipPercent = 0) {
	if (!Number.isFinite(total) || total < 0) throw new RangeError("total must be a number of at least 0");
	if (!Number.isInteger(people) || people < 1) throw new RangeError("people must be a whole number of at least 1");
	const cents = Math.round(total * 100 * (1 + tipPercent / 100));
	const each = Math.ceil(cents / people);
	return `$${(each / 100).toFixed(2)}`;
}
