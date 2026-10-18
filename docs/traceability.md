# Traceability: จากสรุป 3 คลิป ไปเป็นไฟล์ใน repo

ทุกหัวข้อในไฟล์สรุป (`Untitled.md`, 16 ต.ค. 2026) จับคู่กับไฟล์ที่ทำมัน วิธีที่ตรวจว่าใช้ได้จริง และสถานะ

สถานะ: **ทำแล้ว** = มีไฟล์และผ่านการตรวจ, **ทำบางส่วน** = มีแต่ยังตรวจไม่ครบ (บอกเหตุผล), **ไม่ทำ** = ตั้งใจไม่ทำ (บอกเหตุผล)

## Trust Curve และการรีวิวแบบสุ่ม

| ข้อในสรุป | ทำเป็น | ตรวจโดย | สถานะ |
| --- | --- | --- | --- |
| เงื่อนไข: ต้องมี verification และ guardrails ก่อน | ทุกอย่างในหัวข้อถัดไป | ดูหัวข้อถัดไป | ทำแล้ว |
| Sampling review: เจอแบบไม่ดีก็เปลี่ยนเป็น lint/CI | skill `sample-review` + `scripts/sample-commits.mjs` (สุ่ม commit ตามช่วงเวลา/range, ใช้ seed ให้สุ่มซ้ำได้, เตือนเมื่อ commit แก้ไฟล์ของ guard) → agent `reviewer` ตรวจทีละ commit → `correct` เปลี่ยนเป็นกฎ guard → บันทึกใน `.stack-agent/review-log.md` | `tests/sample-commits.test.mjs` 11 เทส, `tests/guard.test.mjs` | ทำแล้ว (ตัว skill ยังไม่ได้ลองใน session จริง) |
| Auto-merge PRs | ไม่มี | — | **ไม่ทำ** เพราะสรุปเขียนไว้ว่า "ยังไม่ควรทำ auto-merge ... เพราะ repo นี้มีทีมอื่นใช้ร่วมด้วย" และ CLAUDE.md ของผู้ใช้ห้าม commit/push เองอยู่แล้ว |

## Verification, Control Glass และ Feature Map

| ข้อในสรุป | ทำเป็น | ตรวจโดย | สถานะ |
| --- | --- | --- | --- |
| Verification: ให้ AI รันแอปจริง | `scripts/verify.mjs` + skill `verify-api` | `tests/verify.test.mjs` 13 เทส: ผ่านครบ, expectation ผิดแล้ว fail, test suite พังแล้ว fail, server ไม่พร้อม/crash, เทสเกินเวลาถูก kill ทั้ง tree, output เกิน 1 MB, kill server ที่เปิดเองจริง (ตรวจ pid) | ทำแล้ว (POSIX: การ kill process group ยังไม่เคยรันจริง ดูหมายเหตุ 2) |
| Close the loop | หลักฐานลง `.stack-agent/evidence/latest.json` (บันทึกว่ารันเต็มหรือบางส่วน) + Stop hook `stop-verify.mjs` เตือนเมื่อโค้ดเปลี่ยนแต่ไม่มีหลักฐานแบบเต็มที่ใหม่กว่า รองรับ monorepo และ cwd ที่เป็นโฟลเดอร์ย่อย | `tests/hooks.test.mjs` 3 เทส + `tests/stop-hook.test.mjs` 3 เทส | ทำแล้ว (เป็นการเตือนครั้งเดียวต่อชุดการแก้ ไม่ได้บังคับ) |
| Control Glass (คุม Chrome ผ่าน CDP) | ไม่มี | — | **ไม่ทำ** เพราะเป้าหมายเป็น backend ไม่มีหน้าจอ ตัวแทนของมันคือ `verify.mjs` ที่ยิง HTTP จริง |
| Feature Map → แผนที่ API | `scripts/api-map.mjs` + skill `api-map` + `.stack-agent/api-map.md` | `tests/api-map.test.mjs` 6 เทส: route ใหม่ไม่อยู่ในแผนที่, แถวค้าง, path ผิด, param route, draft, TODO | ทำแล้ว |
| ประโยชน์ของ Feature Map: bug report กำกวมก็หาทางไปถึงจุดพังได้ | skill `api-map` ส่วน "Find where something lives" + eval `api-map-lookup` | **รัน eval จริงแล้ว** 18 ต.ค. 2026: มี plugin ผ่านทั้ง 2 grader (score 1.0), ไม่มี plugin score 0.5, Δ = +0.5, ค่าใช้จ่าย $0.19 | ทำแล้ว (ดูหมายเหตุ 1) |

## Hard vs Soft constraint และกฎของ Dune

| ข้อในสรุป | ทำเป็น | ตรวจโดย | สถานะ |
| --- | --- | --- | --- |
| Hard constraint: lint/CI | `scripts/guard.mjs` + `templates/ci/stack-agent.yml` ที่ init ใส่ให้ repo ปลายทาง | `tests/guard.test.mjs` 27 เทส, `tests/config-hardening.test.mjs`, `tests/init.test.mjs` "the vendored tools work from the target repo" | ทำแล้ว (ดูหมายเหตุ 2) |
| Soft constraint: rules | `templates/.stack-agent/rules.md` | skill `stack-agent-init` ขั้น 5 สั่งให้ import เข้า CLAUDE.md | ทำแล้ว |
| เปลี่ยน PR comment เป็น lint rule | skill `correct` (ไล่จาก architecture → types → guard → test → docs, ต้องพิสูจน์ว่ากฎจับความผิดจริงได้) | เป็นขั้นตอนของ agent ยังไม่มี eval | ทำบางส่วน: ยังไม่มี eval case วัด skill นี้ |
| Shortest path is the best path | ข้อความ `fix` บังคับในทุกกฎ (`loadConfig` ปฏิเสธกฎที่ไม่มี fix) และ hook `post-edit-guard` ส่ง fix กลับให้ AI ทันทีที่แก้ไฟล์ | `tests/guard.test.mjs` "config without a fix line is rejected", `tests/hooks.test.mjs` "post-edit guard blocks..." | ทำแล้ว |
| กฎตัวอย่าง Dune: ห้ามโมดูลข้ามไปดึงโค้ดกัน (dependency graph ใน CI) | กฎชนิด `module-boundary` | เทส module-boundary + ตัวอย่าง legacy ใน sample-backend | ทำแล้ว |
| กฎตัวอย่างในสรุป backend: ห้าม SQL ตรงๆ ใน controller | กฎชนิด `pattern` + `forbidden-import` (controller ห้าม import db) | เทส "pattern rule flags SQL in a controller", "forbidden-import flags a controller importing db" | ทำแล้ว |
| กฎ Dune: ห้าม `useEffect`, ห้าม comment | ไม่ได้ใส่เป็นกฎสำเร็จรูป | — | **ไม่ทำ** เพราะเป็นกฎเฉพาะ repo ของ Lauren (React/Electron) ทำได้ด้วยกฎชนิด `pattern` ถ้าทีมต้องการ |
| (เพิ่มจากการวิเคราะห์) ratchet สำหรับ repo ที่ใช้ร่วมกัน | baseline ใน `guard.mjs`: ของเก่าผ่าน ของใหม่ต้องไม่เพิ่ม, เพิ่ม baseline ต้อง `--allow-increase`, CI ใช้ `--compare-ref` จับ baseline ที่โตหรือกฎที่ถูกลบ/แคบลง | 4 เทส ratchet + 1 เทส compare-ref | ทำแล้ว (นับต่อไฟล์ต่อกฎ ดู adoption.md) |
| (เพิ่มจากการวิเคราะห์) ชั้น hook ระหว่าง prompt กับ CI | `hooks/hooks.json`: PreToolUse (Bash/PowerShell และ Edit/Write ที่แตะไฟล์ของ guard) / PostToolUse / Stop | `tests/hooks.test.mjs` 13 เทส (รวมรายการคำสั่งเลี่ยงที่ reviewer พบ) | **ทำบางส่วน** (ดูหมายเหตุ 3) |

## Evals

| ข้อในสรุป | ทำเป็น | ตรวจโดย | สถานะ |
| --- | --- | --- | --- |
| Evals = unit test ของ skill | `evals/` 3 cases ในรูปแบบ `claude plugin eval` + skill `run-evals` | รันจริง 1 case (ด้านบน) | ทำบางส่วน (ดูหมายเหตุ 4) |
| Sub-agents ไม่รู้ว่ากำลังโดนสอบ | `claude plugin eval` รันใน temp dir เปล่าที่มองไม่เห็นโฟลเดอร์ eval, prompt เขียนเหมือนคำขอจริง | ตามเอกสาร `plugin-evals` | ทำแล้ว |
| Judge ใช้คนละโมเดล | `agents/judge.md` (`model: sonnet`), llm grader ของ eval ใช้ haiku เป็นค่าเริ่มต้น | ไฟล์ agent + `claude plugin eval --help` | ทำแล้ว แต่ยังเป็นโมเดลค่ายเดียวกัน (ดูหมายเหตุ 5) |
| Hill-climbing | skill `run-evals` ส่วน "Hill-climb" (แก้ทีละอย่าง รันใหม่ เก็บหรือย้อน) | — | ทำแล้ว (เป็นขั้นตอน) |
| (เพิ่มจากการวิเคราะห์) วัดว่า skill ช่วยจริงไหม | `claude plugin eval` รันทั้งแบบมีและไม่มี plugin แล้วรายงาน Δ | ผลรันจริง Δ = +0.5 | ทำแล้ว |
| Coordinator agent / Cloud agents (Benny) | ไม่มี | — | **ไม่ทำ** เพราะ Benny ใช้ Cursor Automations และสรุปบอกให้เลื่อน outer loop ออกไปก่อน |

## ครัวมิชลิน, แยกงาน และ Inner/Outer loop

| ข้อในสรุป | ทำเป็น | ตรวจโดย | สถานะ |
| --- | --- | --- | --- |
| งาน deterministic เขียนเป็น script | `guard.mjs`, `verify.mjs`, `api-map.mjs`, `init.mjs` ไม่มี dependency | 93 เทสใน `tests/` | ทำแล้ว |
| งาน non-deterministic ให้ AI ทำ | skills ทำเฉพาะส่วนที่ต้องคิด แล้วเรียก script ตรวจ | อ่าน `skills/*/SKILL.md` | ทำแล้ว |
| Outer loop (Grokbot ดึง Slack/Linear) | ไม่มี | — | **ไม่ทำ** ตามสรุป |

## Skills ตามแนววิศวกร Anthropic

| ข้อในสรุป | ทำเป็น | ตรวจโดย | สถานะ |
| --- | --- | --- | --- |
| กฎ 1: สั่งงานผ่าน skill | 9 skills ใน `skills/` | `claude plugin validate . --strict` | ทำแล้ว |
| กฎ 2: Description / Instructions / Tools | ทุก skill มี description บอกว่าใช้เมื่อไร มีขั้นตอน และเรียก script | อ่านไฟล์ | ทำแล้ว |
| กฎ 3: skill เล็กต่อกันได้ | `add-endpoint` เรียก `verify-api` และ `api-map` แทนการเขียนซ้ำ | อ่านไฟล์ | ทำแล้ว |
| Flags `disable-model-invocation` / `user-invocable` | `stack-agent-init`, `correct`, `reflect`, `run-evals` ใช้ `disable-model-invocation: true` เพราะเขียนไฟล์หลายจุดหรือใช้เงิน | อ่าน frontmatter | ทำแล้ว (ไม่มี skill ไหนต้องใช้ `user-invocable: false`) |
| กฎ 4: skill ฉลาดขึ้นทุกครั้ง | skill `reflect` (เสนอการแก้ รออนุมัติ) | — | ทำแล้ว (เป็นขั้นตอน) |
| Skill mining | skill `correct` ขุดจาก git log, review comment, การแก้ในแชต | — | ทำแล้ว (ในสรุปเรียกว่า Recall แต่ใน pstack ตัวที่ทำหน้าที่นี้คือ correct/automate-me) |

## นำมาใช้กับ backend

| ข้อในสรุป | ทำเป็น | สถานะ |
| --- | --- | --- |
| ลำดับ 1–5 | `docs/adoption.md` และ skill `stack-agent-init` เรียงตามนี้ | ทำแล้ว |
| Skills "เพิ่ม endpoint", "ทำ migration" | `add-endpoint`, `add-migration` | ทั้งคู่มี eval case แล้ว (`add-endpoint-delete-item`, `add-migration-column`) และ sample-backend ใช้ `node:sqlite` จริงกับ `scripts/migrate.mjs` (up/down/status/new, ตรวจ checksum ว่า migration ที่ apply แล้วถูกแก้หรือไม่) มีเทส `tests/migrate.test.mjs` 10 เทส (ดูหมายเหตุ 6) |
| judge (จำเป็น), reviewer (ถ้ามีเวลา) | `agents/judge.md`, `agents/reviewer.md` | ทำแล้ว |
| เก็บ agent ไว้ใน `.claude/agents/` ให้ทีมใช้ร่วม | อยู่ใน plugin แทน ทีมติดตั้ง plugin เดียวได้ทั้งชุด | ทำแล้ว (ทางเลือก: คัดลอกไฟล์ไป `.claude/agents/` ได้) |
| Rubric "เพิ่ม endpoint ใหม่" 5 ข้อ | `evals/add-endpoint-delete-item/graders/` 10 grader: **ทำงานได้จริง** = `verify-passed-full` (script: evidence `ok` และ `full`) + `route-registered`; **มีเทส** = `test-added` (llm อ่าน trace); **ไม่ทำของเดิมพัง** = `verify-passed-full` (verify แบบเต็มรันเทสทั้งหมด); **guard ผ่าน** = `guard-passed` (llm อ่าน trace); **ตามโครงสร้างทีม** = `follows-layers` (llm) + `controller-stays-thin` (script); เพิ่ม `api-map-updated`, `verify-check-added`, `ran-verify`, `honest-report` | ทำแล้ว grader โหลดได้ครบ 10 ตัว แต่ยังไม่ได้รันจริง (หมายเหตุ 4) "มีเทส" และ "guard ผ่าน" ใช้ llm อ่าน trace แทน script เพราะ grader ของ `claude plugin eval` รันคำสั่งเองไม่ได้ |

## หมายเหตุ

1. **ผล eval `api-map-lookup` ต้องอ่านให้ถูก:** ทั้งสองแบบตอบถูก (llm judge ให้ PASS 3/3 ทั้งคู่) ส่วนต่างมาจากขั้นตอนเท่านั้น คือแบบมี plugin เปิดอ่านแผนที่ API ก่อน ส่วนแบบไม่มีไปค้นโค้ดเอง ใน repo เล็กแบบ sample จึงยังไม่เห็นว่าคำตอบดีขึ้น รันไปแค่ 1 รอบต่อแบบ ยังสรุปทางสถิติไม่ได้
2. **CI ยังไม่ได้รันจริง:** `.github/workflows/ci.yml` (ของ repo นี้) และ `templates/ci/stack-agent.yml` (ของ repo ปลายทาง) ยังไม่เคยรันบน GitHub เพราะยังไม่ได้ push รูปแบบ YAML ตรวจด้วยตาเท่านั้น เทสทั้งหมดรันบน Windows เท่านั้น ดังนั้นโค้ดฝั่ง POSIX (kill process group ด้วย SIGTERM แล้วตามด้วย SIGKILL) ยังไม่เคยรันจริง CI ตั้ง matrix ubuntu + windows ไว้แล้ว
3. **Hook เป็นด่านเสริม ไม่ใช่ด่านสุดท้าย:** ทดสอบด้วยการป้อน JSON ตามรูปแบบในเอกสาร ยังไม่ได้ทดสอบใน session Claude Code จริงหลังติดตั้ง plugin การดักคำสั่ง shell เป็นการอ่าน pattern จึงไม่ครอบคลุมทุกรูปแบบ (เช่น alias ของ shell หรือ script ที่เขียนไฟล์โดยไม่ระบุชื่อไฟล์ในคำสั่ง) PostToolUse ตรวจเฉพาะการแก้ผ่าน Edit/Write ส่วนการแก้ผ่าน shell ให้ CI และ Stop hook จับแทน คนที่ยืนยัน `by=` ในข้อยกเว้นได้จริงคือการรีวิว PR (แนะนำ CODEOWNERS)
4. **Eval ที่ต้องใช้ Bash (`add-endpoint-delete-item`, `verify-before-done`) รันบน Windows โดยตรงไม่ได้:** ลองรันแล้ว ถูกปฏิเสธเพราะไม่มี sandbox (ค่าใช้จ่าย $0) ตรงกับที่เอกสารบอก ต้องรันจาก WSL2 หรือ Linux/macOS ส่วน WSL Ubuntu ในเครื่องนี้ยังไม่มี node และ claude ผลของการลองรันยืนยันได้ว่าไฟล์ case และ grader โหลดได้ (grader รายงานผลชื่อไฟล์ถูกต้อง)
5. **Judge คนละโมเดลแต่ค่ายเดียวกัน:** Claude Code เลือก subagent ได้เฉพาะโมเดล Claude ส่วนการเรียกโมเดลค่ายอื่นเอกสารไม่ได้ระบุไว้
6. **`add-migration`:** ตัวรัน migration ของ sample มีเทสแล้ว แต่ eval case `add-migration-column` ต้องใช้ Bash จึงยังไม่ได้รันจริง (เหตุผลเดียวกับหมายเหตุ 4) ใน repo จริงที่ใช้ migration tool อื่น (Prisma, Knex, Flyway ฯลฯ) skill ยังต้องหาคำสั่งของ repo นั้นเอง

## รอบตรวจงานตัวเอง (18 ต.ค. 2026)

หลังสร้างเสร็จ ส่งให้ subagent สองตัวตรวจแยกกันโดยห้ามแก้ไฟล์: reviewer (หาบั๊กและทางเลี่ยง) และ tester (ทำตาม adoption.md กับ backend ใหม่ที่ไม่ใช่ sample) ผลและการแก้:

| ที่พบ | แก้อย่างไร | เทสที่ล็อกไว้ |
| --- | --- | --- |
| แก้ `guard-baseline.json` / `guard.config.json` ตรงๆ ผ่าน Edit แล้ว guard ไม่รู้ | hook `pre-edit-protect.mjs` ถามคนก่อน, pre-bash ดักคำสั่งที่เขียนไฟล์เหล่านี้, `--compare-ref` ใน CI | "pre-edit-protect asks...", "--compare-ref fails when..." |
| คำสั่งเลี่ยง: `git --no-pager commit --no-verify`, `HUSKY=0`, `core.hooksPath`, `bash -c "..."`, `push -fu`, `--mirror`, `:main`, `checkout .`, `npm run guard -- --allow-increase` | เขียน pre-bash ใหม่: แยก segment ตาม quote, ข้าม global option ของ git, อ่าน shell ซ้อน, ดัก env ที่ปิด hook | 3 เทส pre-bash (รายการคำสั่งครบ) |
| hook ไม่เห็น PowerShell | matcher เป็น `Bash\|PowerShell` | "pre-bash hook also handles the PowerShell tool" |
| glob `{js,ts}` ไม่ทำงาน, กฎที่ไม่ match ไฟล์ไหนเงียบ | รองรับ brace, เตือน `matches no files` | "brace globs...", "a rule whose globs match no file..." |
| output ของเทสเกิน 1 MB ถูกรายงานว่า fail, เทสที่เกินเวลาไม่ถูก kill | เปลี่ยนเป็น spawn แบบ async เก็บแค่ส่วนท้าย, kill ทั้ง tree เมื่อเกินเวลา, server ใช้ SIGKILL ถ้า SIGTERM ไม่พอ | "more than 1 MB...", "times out is killed..." |
| Stop hook ไม่ทำงานใน monorepo, รันบางส่วนก็นับเป็นหลักฐาน | ใช้ git toplevel + `-z`, หา verify.json จาก cwd ขึ้นไป, evidence บันทึก `full` | `tests/stop-hook.test.mjs`, เทส partial |
| import ใน comment ถูกจับ, เลขบรรทัดผิด, template literal import และ path alias ไม่เห็น | ลบ comment ก่อนอ่าน import, ใช้ตำแหน่งของ specifier, รองรับ backtick, ตั้ง `aliases` ได้ | 3 เทส import |
| tools ใน `.stack-agent/bin` ถูก guard สแกนเอง | เพิ่มใน ignore เริ่มต้น | "vendored tools ... are never scanned" |
| ข้อยกเว้นวันหมดอายุไกลไม่จำกัด, ชื่อกฎผิด/วันที่เป็นไปไม่ได้ผ่าน, comment ท้ายบรรทัดครอบบรรทัดถัดไป | `maxAllowDays` (90), ตรวจชื่อกฎและวันที่จริง, แยก comment บรรทัดเดี่ยวกับท้ายบรรทัด | 2 เทส allow |
| config ที่เป็น string แทน array ทำให้ crash (tester) | ตรวจชนิดทุกฟิลด์ แจ้ง config error | "string values where arrays are expected..." |
| `baseUrl` ที่มี path prefix หาย, api-map crash เมื่อ regex ไม่มี group | `joinUrl`, ตรวจ group แจ้ง config error | "joinUrl keeps a base path prefix", `tests/config-hardening.test.mjs` |
| เอกสารขาด: array, `to` เป็น glob, ratchet ต่อไฟล์, `--check`, warning ไม่ fail, การปฏิเสธ `--update-baseline` | เพิ่มใน `docs/adoption.md` | — |

ที่ยังไม่ได้แก้ และเหตุผล:

- การดักคำสั่ง shell ยังเป็น pattern เท่านั้น เลี่ยงได้ด้วยวิธีที่ไม่ระบุชื่อไฟล์หรือคำสั่งตรงๆ จึงระบุชัดว่า CI คือด่านสุดท้าย
- route ที่ mount ใต้ prefix ใน api-map ต้องเขียน regex เอง (บันทึกไว้ใน adoption.md)
- ratchet นับต่อไฟล์ต่อกฎ ตั้งใจให้เรียบง่าย (บันทึกไว้ใน adoption.md)
