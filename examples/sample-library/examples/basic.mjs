// Uses the library the way a consumer would: by package name, through package.json "exports".
import { isSlug, slugify } from "tinyslug";

const slug = slugify("Crème Brûlée: A Recipe!");
console.log(slug);
console.log(`isSlug: ${isSlug(slug)}`);
