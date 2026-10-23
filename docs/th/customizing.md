# ปรับ Stack Agent ให้เป็นของทีมคุณ

Stack Agent ทำมาให้ fork ไปแก้ หน้านี้บอกว่าแต่ละส่วนอยู่ตรงไหน และแก้อย่างไรโดยไม่ทำให้ส่วนอื่นพัง ไอเดียที่ตัดสินใจไม่รับพร้อมเหตุผลอยู่ใน [out-of-scope.md](out-of-scope.md)

[English](../customizing.md)

## ใช้แบบ plugin หรือ fork?

| ต้องการ | ทำแบบนี้ |
| --- | --- |
| ใช้ตามที่เป็นอยู่และได้อัปเดต | ติดตั้ง plugin แล้วเก็บค่าที่เฉพาะโปรเจคไว้ในไฟล์ `.stack-agent/` ของ repo |
| แก้ skill, hook, preset หรือค่าเริ่มต้นให้ทั้งทีม | fork repo แก้ไข แล้วให้ทีมติดตั้งจาก fork ของคุณ |
| อยากเป็นเจ้าของทุกไฟล์ในโปรเจคเดียว | คัดลอก `skills/`, `agents/`, `hooks/` ไปไว้ใน `.claude/` ของโปรเจค แล้วรัน `init.mjs` เพื่อคัดลอกเครื่องมือ |

ถ้าจะเผยแพร่ fork เป็น plugin ของตัวเอง ให้เปลี่ยน `name` ใน `.claude-plugin/plugin.json` และ `.claude-plugin/marketplace.json` (รวมถึง `owner`, `repository`, `author`) แล้วรัน:

```bash
claude plugin validate . --strict
```

```bash
claude plugin marketplace add <you>/<your-fork>
```

## โครงสร้าง repo

```
.claude-plugin/   plugin.json, marketplace.json
agents/           judge.md, reviewer.md, finding-verifier.md
hooks/            hooks.json (ผูก scripts/hooks/*.mjs เข้ากับ Claude Code)
skills/<name>/    SKILL.md หนึ่งไฟล์ต่อ skill และ script ที่ skill เรียกใช้
scripts/          guard.mjs, verify.mjs, api-map.mjs, feature-map.mjs, init.mjs, sample-commits.mjs,
                  review-findings.mjs, review-worktree.mjs, lib/, hooks/
templates/        common/ (ไฟล์กฎ), ci/ (workflow), presets/<name>/ (config ของ verify และ guard)
examples/         sample-backend (Node HTTP API), sample-cli (Python CLI),
                  sample-library (Node package), sample-frontend (static web app),
                  sample-generic (CSV data job)
evals/            eval case ของ claude plugin eval และ scaffold.mjs
tests/            ชุดเทส node:test สำหรับทุก script และ hook
```

กติกาที่ทำให้ fork ไม่พัง:

- script เป็น Node ESM ธรรมดาและไม่มี dependency เพราะ repo ปลายทางคัดลอกไปไว้ใน `.stack-agent/bin/` และ CI รันได้โดยไม่ต้อง `npm install`
- `init.mjs --check` รายงานไฟล์ที่คัดลอกไว้เป็น `outdated` เมื่อเนื้อหาไม่ตรงกับ `scripts/` ทุก byte ดังนั้นทุกการแก้ script จะไปถึงทีมที่ใช้งานในรูปของคำเตือนให้รัน init ซ้ำ script ใหม่ที่ต้องคัดลอกให้เพิ่มใน `TOOLS` ของ `scripts/init.mjs` และเมื่อออก release ให้เพิ่ม `version` ใน `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` และ `package.json` พร้อมกัน (init จะเขียนค่านี้ลง `.stack-agent/bin/VERSION`) แล้วเพิ่มหัวข้อใน `CHANGELOG.md` และ `CHANGELOG.th.md`
- ทุกพฤติกรรมของ script มีเทสใน `tests/` ให้รัน `npm test` ทุกครั้งที่แก้
- `claude plugin validate . --strict` ต้องผ่านหลังแก้ `.claude-plugin/`, `skills/`, `agents/` หรือ `hooks/`

## เพิ่ม preset

1. สร้าง `templates/presets/<name>/` ที่มี `verify.json` และ `guard.config.json` ใส่ `api-map.json` เฉพาะ preset ที่ใช้แผนที่ API ส่วน preset ที่ไม่มีจะได้ template ของ feature map (`templates/common/feature-map.md`) จาก `init`
2. เก็บกฎสากล (`no-merge-conflict-markers`, `no-private-keys`) ไว้ใน config ของ guard
3. ใส่ `EDIT ME` ในทุกค่าที่ผู้ใช้ต้องกรอก `init.mjs --check` จะรายงานไฟล์ที่ยังมีคำนี้
4. เพิ่มชื่อ preset ในรายการที่คาดไว้ใน `tests/presets.test.mjs` ชุดเทสจะตรวจเองว่า config ของทุก preset โหลดได้
5. เพิ่ม preset ในตารางของ `README.md`, `docs/adoption.md` และ `skills/stack-agent-init/SKILL.md`

ไอเดียที่น่าทำ: `mobile` (คำสั่ง simulator เป็น command check), `data-pipeline` (รันตัวอย่างแล้วเช็กจำนวนแถว), `infra` (`terraform validate` และ `plan` เป็น command check)

## เพิ่มกฎ guard

กฎอยู่ใน `.stack-agent/guard.config.json` ของแต่ละโปรเจค ไม่ได้อยู่ใน repo นี้ ถ้าต้องการให้ทุกโปรเจคในทีมมีกฎนั้น ให้เพิ่มลงใน template ของ preset (สำหรับโปรเจกต์ใหม่) หรือเขียนกฎไว้ในไฟล์ JSON กลางที่ config ของแต่ละโปรเจกต์ระบุไว้ใน `extends` (สำหรับโปรเจกต์ใน repository เดียวกัน ดู adoption หัวข้อ "กฎกลาง") หรือคัดลอกไฟล์กฎไฟล์เดียวเข้าไปในโปรเจกต์ของ repository อื่นด้วย `init.mjs --shared-rules <file>`

- `message` บอกว่าผิดอะไร `fix` บอกชื่อไฟล์ ฟังก์ชัน หรือโมดูลที่ให้ใช้แทน guard จะไม่รับกฎที่ไม่มี `fix`
- พิสูจน์ว่ากฎจับความผิดจริงในอดีตได้ก่อนพึ่งพา (`guard.mjs --strict` หรือ fixture ในเทส)
- กฎ import อ่านได้ทั้ง JS/TS และ Python ภาษาอื่นให้ใช้กฎแบบ `pattern`

ถ้าจะเพิ่ม *แบบ* ของกฎใหม่ (เช่นอ่าน import ของภาษาอื่น) ให้ขยาย `findViolations` ใน `scripts/guard.mjs` ตรวจฟิลด์ใน `loadConfig` และเพิ่มเทสข้างเทสเดิมใน `tests/guard.test.mjs`

## เพิ่ม skill

1. สร้าง `skills/<name>/SKILL.md` พร้อม frontmatter:

   ```markdown
   ---
   name: <name>
   description: ใช้เมื่อไร รวมคำที่คนมักพิมพ์ ส่วนนี้คือสิ่งที่ Claude ใช้ตัดสินว่าจะหยิบ skill มาใช้หรือไม่
   ---
   ```

2. ใส่ `disable-model-invocation: true` สำหรับ skill ที่คนควรสั่งเอง (เขียนไฟล์หลายจุด ใช้เงิน หรือเปลี่ยนสิ่งที่ใช้ร่วมกัน) และใส่ `user-invocable: false` สำหรับ skill ที่ให้ agent ใช้เองเท่านั้น
3. ทำให้เล็กและต่อกันได้ เช่นเรียก `verify` แทนการเขียนขั้นตอนซ้ำ
4. โค้ดที่ agent ต้องเขียนซ้ำทุกครั้ง ให้เก็บเป็น script ในโฟลเดอร์ของ skill แล้วอ้างด้วย `${CLAUDE_SKILL_DIR}/script.mjs`
5. เพิ่ม eval case (ด้านล่าง) เพื่อวัดว่า skill ช่วยจริงไหม

### เขียนเนื้อหา skill

agent จะทำตาม skill แบบเดิมทุกครั้งก็ต่อเมื่อข้อความเปิดช่องให้ตีความได้น้อย กฎเหล่านี้มาจาก `writing-for-agents` ของ mattpocock/skills และ `writing-skills` ของ obra/superpowers (MIT ทั้งคู่) ข้อที่ script ตรวจได้ `tests/skills.test.mjs` ตรวจให้แล้ว

- **description บอกว่าใช้เมื่อไร ไม่บอกว่าทำอย่างไร** ระบุสถานการณ์และคำที่ควรเปิด skill กรณีละหนึ่งอย่าง โดยเอาคำที่ชัดที่สุดขึ้นก่อน และไม่ต้องใส่ขั้นตอน superpowers พบว่า agent ที่ได้ description ซึ่งสรุปขั้นตอนไว้จะทำตามบทสรุปแล้วข้าม skill ไป เช่นรีวิวแค่รอบเดียวทั้งที่ skill กำหนดสองรอบ เทสจะ fail ถ้า description มีคำว่า "then" หรือ "step" ส่วน description ใช้ได้ผลหรือไม่ต้องวัด ไม่ใช่เถียงกัน skill `debug` ถูกหยิบใช้จาก bug report เพิ่มจาก 0 ใน 9 เป็น 9 ใน 9 หลังจากเปลี่ยน description ให้ขึ้นต้นด้วย "Use this first for any bug report" (design notes, 2026-10-23)
- **ทุกขั้นจบด้วยสิ่งที่ agent มองเห็นได้** เขียน "Done when" ให้เป็นสิ่งที่สังเกตได้ เช่น output ของคำสั่ง ไฟล์ที่ต้องมีอยู่ หรือผลที่ออกเหมือนเดิมเมื่อรันซ้ำ คำว่า "เมื่อเข้าใจสาเหตุแล้ว" ทำให้ agent หยุดเร็วเกินไป แต่ "repro แดงตรงอาการที่ผู้ใช้เจอสองรอบติด" ไม่เปิดช่องนั้น ยิ่งเกณฑ์เข้ม (เช่น "ทุก route ที่แก้มี check") agent ก็ยิ่งต้องขุดลึก
- **บอกสิ่งที่ต้องทำ ไม่ใช่บอกแค่สิ่งที่ห้ามทำ** คำห้ามจะดึงพฤติกรรมที่ห้ามขึ้นมาตรงหน้า agent และอาจได้ผลกลับ ใน micro-test ของ superpowers (รันคำละ 5 รอบ) คำว่า "don't restate the brief" ทำให้มีค่าที่ถูกพิมพ์ซ้ำเฉลี่ย 4.4 ค่าต่อข้อความ มากกว่า 3.6 ตอนที่ไม่สั่งอะไรเลย ส่วนสูตรเชิงบวกที่บอกว่าข้อความต้องมีอะไรบ้างได้ 3.0 และไม่แกว่ง แต่คำห้ามก็ไม่ได้ผิดเสมอ ในชุดเดียวกัน "do not ask the reviewer to re-run tests" ไม่มีการฝ่าฝืนเลยทั้ง 5 รอบ เทียบกับฝ่าฝืน 3 ใน 5 รอบเมื่อไม่มีคำนี้ ให้นำด้วยเป้าหมายเชิงบวก เก็บคำห้ามไว้สำหรับข้อจำกัดเด็ดขาดที่ผูกกับการกระทำเฉพาะเจาะจง และวัดผลเมื่อเป็นเรื่องสำคัญ
- **ใช้คำที่หนักแน่นคำเดียวแทนความคิดหนึ่ง แล้วใช้ซ้ำ** `debug` ใช้คำว่า *repro* และ *red* แทนที่จะอธิบาย "คำสั่งที่ fail ได้แน่นอนบนบั๊กนี้" ทุกครั้ง คำที่ model รู้จักอยู่แล้วพาความหมายมาเองโดยไม่ต้องอธิบาย ส่วนคำที่คิดขึ้นเองต้องมีคำนิยาม
- **อย่าคัดลอกสภาพแวดล้อมลงไป** รายการคำสั่ง ตาราง flag หรือโครงสร้างโฟลเดอร์ที่คัดลอกไว้ใน skill จะล้าสมัย ให้ชี้ไปที่ต้นทาง (`--help`, `package.json`, ไฟล์ config) แล้วเขียนเฉพาะสิ่งที่ agent หาเองไม่ได้ เช่น เหตุผลของการเลือก จุดที่มักพลาด หรือธรรมเนียมที่ไม่ได้เขียนไว้ที่ไหน
- **ตัดประโยคที่ไม่เปลี่ยนอะไร** คำสั่งที่ model ทำอยู่แล้วโดยไม่ต้องบอก กินความสนใจโดยไม่ได้อะไร ให้ลบทั้งประโยค ถ้าคนเห็นไม่ตรงกันว่าบรรทัดไหนสำคัญ ให้รัน eval case แบบมีและไม่มีบรรทัดนั้นแทนการเถียง
- **อยู่ในขนาดที่กำหนด** Claude Code ตัด skill ที่แนบกลับเข้ามาหลัง compaction ที่ 20,000 ตัวอักษร ส่วนที่เกินจะหายไปตลอด session ให้ย้ายข้อมูลอ้างอิงที่ใช้เฉพาะบางกรณีไปไว้ในไฟล์ข้าง `SKILL.md` แล้วชี้ไปจากขั้นที่ต้องใช้
- **เลือก check ก่อนประโยค** กฎที่ตรวจได้ให้ทำเป็นกฎ guard, verify check หรือเทส (ตามลำดับของ skill `correct`) แล้วเก็บ skill ไว้สำหรับเรื่องที่ต้องใช้วิจารณญาณ

ก่อนเขียน skill เพื่อแก้พฤติกรรมใด ให้แสดงพฤติกรรมนั้นโดยยังไม่มี skill ก่อน: รัน eval case หรือ A/B task กลุ่มที่ไม่มี plugin แล้วดูว่าเกิดปัญหาจริงไหม ถ้า agent ทำถูกอยู่แล้วโดยไม่มี skill ก็ไม่มีอะไรต้องแก้

## แก้นโยบายของ hook

`scripts/hooks/pre-bash.mjs` ตัดสินว่าคำสั่ง shell ไหนถูกปฏิเสธ หรือต้องให้คนอนุมัติ:

- `deny` สำหรับคำสั่งที่ข้ามการตรวจ (`--no-verify`)
- `ask` สำหรับคำสั่งที่ทำลายข้อมูลหรือผ่อนกฎ

กฎเกี่ยวกับ git (`--no-verify`, ตัวแปรที่ปิด hook, force-push, `reset --hard`, การลบหรือบังคับย้าย branch, การทิ้งการแก้ทุกไฟล์ และการลบ `.github/workflows`) ทำงานเฉพาะในโปรเจกต์ที่ติดตั้ง Stack Agent คือมี `.stack-agent/verify.json` หรือ `.stack-agent/guard.config.json` อยู่ใน folder ของ session หรือ folder ที่อยู่เหนือขึ้นไป การติดตั้ง plugin ระดับผู้ใช้จึงไม่เปลี่ยนการทำงานของ repository อื่น ส่วนกฎเกี่ยวกับไฟล์ของ Stack Agent เอง (config และ baseline ของ guard, `.stack-agent/bin`, หลักฐาน, session record และ `--allow-increase`) ทำงานทุกที่ โปรเจกต์หาจาก folder ของ session ดังนั้นคำสั่งที่ชี้ไป repository อื่น (`git -C ../other ...`) จะถูกตัดสินตามโปรเจกต์ของ session

path ที่ป้องกันอยู่ใน `scripts/hooks/protected-paths.mjs` ทุก pattern มีแถวใน `tests/hooks.test.mjs` ให้เพิ่มของคุณในเทสก่อน แล้วแก้โค้ดจนผ่าน และเก็บคำสั่งปกติไว้ในรายการ "lets ordinary commands through" เพื่อไม่ให้นโยบายที่เข้มขึ้นไปบล็อกงานปกติ

## เพิ่ม eval case

1. สร้าง `evals/<case>/` ที่มี `case.yaml` (`schema_version: "1.1"`, `name`, `context.scaffold_script: scaffold.sh`), `prompt.md` (คำขอที่เขียนเหมือนผู้ใช้จริงและไม่พูดถึงการทดสอบ) และ `graders/*.md`
2. `scaffold.sh` เรียก `node "$(dirname "$0")/../scaffold.mjs"` ซึ่งคัดลอก `examples/sample-backend` ไปที่โฟลเดอร์ที่ใช้รัน ถ้าจะใช้ตัวอย่างอื่นให้คัดลอกแล้วดัดแปลง case ที่ต้องเริ่มจากประวัติใน git (บั๊กที่ฝังไว้ หรือความผิดพลาดที่เกิดซ้ำสองครั้ง) ให้เพิ่ม `setup.mjs` ที่เรียก `plant()` จาก `evals/plant.mjs` และรันต่อจาก `scaffold.mjs` (ดู `debug-blank-name`) ส่วน `tests/evals.test.mjs` ตรวจว่าทุก case มีรูปแบบถูกต้อง และ setup ฝังสถานะที่ grader คาดไว้จริง
3. ใช้ grader แบบ script (`regex`, `file_exists`, `tool_used`) เป็นหลัก และใช้ `llm` เฉพาะข้อที่ต้องใช้ดุลยพินิจ
4. รัน:

   ```bash
   claude plugin eval . --case <case> --scaffold --runs 1 --no-publish
   ```

   case ที่แก้โค้ดต้องเพิ่ม `--allow-tools Bash Write Edit` และต้องรันบน Linux, macOS หรือ WSL2

### รัน eval ที่ใช้ Bash (WSL2, Linux, macOS)

case ที่แก้โค้ดต้องใช้ sandbox ซึ่ง Windows แบบ native ไม่มี บันทึกจากการรันใน WSL2 Ubuntu 24.04:

- ติดตั้ง Node นอก `/home` เพราะ sandbox ของ eval อ่าน `/home` ไม่ได้ Node ที่อยู่ใน `~/.local` จะกลายเป็น "command not found" ระหว่างรัน ส่วน `/usr/local` ใช้ได้
- ติดตั้ง `bubblewrap` กับ `socat` และ login ด้วย `claude auth login` ใน WSL
- การเชื่อม WSL ของ Docker Desktop สร้างลิงก์ไว้ใน `~/.docker` และ Claude Code จะไม่ยอมรัน eval ที่ให้ใช้ Bash ถ้ามีลิงก์ในโฟลเดอร์นั้น ให้ย้าย `~/.docker` ออกชั่วคราวระหว่างรันแล้วย้ายกลับ
- ใส่ `--allow-tools Bash Write Edit` (`prompt.md` ของแต่ละ case บอกว่าใช้เครื่องมืออะไรได้ ส่วน flag นี้คือการอนุญาต) และใส่ `--case` ครั้งเดียวต่อการรัน เพราะระบบนับแค่ตัวสุดท้าย
- ใน `claude plugin eval` Bash ที่อยู่ใน sandbox เขียนไฟล์ไม่ได้เลย แม้แต่ใน `$TMPDIR` (ตรวจด้วย case ทดสอบ) จึงรัน verify, เทสที่เขียนฐานข้อมูล และ migration ไม่ได้ case เหล่านี้จึงให้คะแนนความซื่อตรง (`honest-report`: มีหลักฐานจริง หรือบอกตรงๆ ว่าตรวจไม่ได้เพราะอะไร) และตัวโค้ด ไม่ใช่หลักฐานจาก verify การวัดการตรวจงานให้ใช้ `scripts/ab/run.mjs` ซึ่งรัน session จริง

## เพิ่มโปรเจคตัวอย่าง

ตัวอย่างใช้เป็น fixture ของเทสด้วย ให้ทำตามโครงของ `examples/sample-cli`: มีซอร์สจริง มีเทสของตัวเอง มี `.stack-agent/` ที่กรอกครบ (ไม่มี `EDIT ME`) และมี `guard-baseline.json` ว่างที่สร้างด้วย `guard.mjs --update-baseline` แล้วเพิ่มไฟล์เทสแบบ `tests/sample-cli.test.mjs` ที่รัน guard และ verify ของตัวอย่าง และเพิ่มขั้นใน CI

## วัดพฤติกรรมของ agent (A/B)

`scripts/ab/run.mjs` รัน task เดียวกันบนสำเนาใหม่ของ `examples/sample-backend` ทั้งแบบมีและไม่มี plugin แล้วตรวจผลด้วย script (HTTP probe อิสระ, เทส, guard, API map และหลักฐานจาก verify) ไม่เชื่อสรุปของ agent เอง คำสั่งนี้เรียก `claude -p` จึงเสียเงินจริง

```bash
npm run ab -- --task endpoint --task validate --arms full,none --runs 3 --model sonnet --budget 1
```

| ตัวเลือก | ความหมาย |
| --- | --- |
| `--task NAME` | task ใน `scripts/ab/tasks/` ตั้งชื่อตามไฟล์ (`endpoint`, `validate`, `bug-blank-name`, ...) ถ้าใส่ชื่อที่ไม่มีจะพิมพ์รายชื่อทั้งหมดออกมา ใส่ซ้ำได้หลายตัว จำเป็นต้องมี |
| `--arms` | รายการคั่นด้วย comma จาก `full` (plugin ตามเดิม), `none` (ไม่มี plugin), `hooks-only` (สำเนาที่ไม่มี `skills/`), `skills-only` (สำเนาที่ไม่มี `hooks/hooks.json`) ค่าเริ่มต้น `full,none` |
| `--runs N` | จำนวนรอบต่อ task และ arm ค่าเริ่มต้น 1 |
| `--model`, `--budget USD` | ต้องระบุทั้งคู่ งบเป็นเพดานต่อรอบ ส่งเป็น `--max-budget-usd` และไม่มีค่าเริ่มต้นโดยตั้งใจ |
| `--plugin DIR`, `--out DIR` | plugin ที่จะทดสอบ (ค่าเริ่มต้นคือ repo นี้) และที่เก็บผล (ค่าเริ่มต้นคือโฟลเดอร์ใหม่ใน temp ของระบบ) |
| `--no-isolate` | ไม่ส่ง `--setting-sources project,local --strict-mcp-config` ปกติจะแยกให้เสมอ |
| `--judge MODEL` | ให้คะแนน `rubric` ของ task ด้วย (เกณฑ์ที่ script ตรวจไม่ได้ เช่น "controller แค่อ่าน request") โดยใช้ `agents/judge.md` รันเป็น session `claude` ที่สองด้วย MODEL judge อ่านสำเนาของรอบนั้นที่ตั้งชื่อแบบสุ่ม มีการแก้อยู่ใน `CHANGES.diff` และไม่มีหลักฐานของ verify ไฟล์ skip หรือ config ของ Stack Agent (เหลือแค่ `rules.md`) จึงบอกไม่ได้ว่าเป็นกลุ่มไหน แต่ละเกณฑ์จะเป็นคอลัมน์ `judge:...` ข้อที่ judge ไม่ตอบนับเป็นไม่เกี่ยวข้อง ปิดไว้เป็นค่าเริ่มต้น เพราะเสียเงินเพิ่มได้ถึง `--budget` ต่อรอบ |
| `--dry-run` | สร้างโปรเจคและตรวจสำเนาที่ยังไม่แก้ ไม่เรียก `claude` ไม่เสียเงิน ใช้เช็ก task ใหม่ |
| `--json` | พิมพ์ผลเป็น JSON แทนตารางสรุป |

**ค่าใช้จ่าย** วัดกับ Sonnet แล้วรอบละประมาณ $0.25 ถึง $0.45 ดังนั้น `--runs 3` กับ 2 task และ 2 arm อยู่ราว $3 ถึง $5 ลอง `--dry-run` ก่อน

**การแยกสภาพแวดล้อม** plugin และ settings ของคุณเองจะปนเข้าไปทั้งสองฝั่งถ้าไม่แยก จึงใช้ `--setting-sources project,local` และ `--strict-mcp-config` (ไม่โหลด MCP server ของผู้ใช้) ทุกรอบ และ harness อ่าน event `system/init` ของทุก transcript รอบที่ผิดเงื่อนไขจะถูกตั้งเป็น `invalid` ตัดออกจากตารางสรุป แจ้งเตือนดังๆ และ exit code เป็น 1 เมื่อ arm ที่มี plugin โหลด plugin อื่นนอกจาก `stack-agent`, arm `none` โหลด plugin ใดๆ, `hooks-only` ยังเห็น skill `stack-agent:` หรือ `skills-only` ยังเห็น hook ของ Stack Agent ทำงาน plugin ที่มากับ Claude Code (`@builtin`) ไม่นับ

**สิ่งที่บันทึก** ใน `<out>/results.json` ทุกรอบ: git SHA ของ plugin และ worktree สกปรกหรือไม่, เวอร์ชัน harness, `claude --version`, model, arm, task, prompt, งบ, เวลาเริ่มและจบ, ค่าใช้จ่ายและจำนวน turn, จำนวน hook feedback กับบรรทัดแรก, skill ที่ agent เรียก, ผลการแยกสภาพแวดล้อม และผลของทุก grader ส่วน transcript ดิบอยู่ที่ `<out>/runs/<task>-<arm>-<n>.jsonl` และโปรเจคของแต่ละรอบอยู่ที่ `<out>/projects/` ดูว่า agent ทำอะไรจริงๆ ด้วย:

```bash
node scripts/ab/inspect.mjs <out>/runs
```

จะแสดง skill ที่เรียก, feedback จาก Stop hook ว่ามาก่อนหรือหลังการแก้ `verify.json` ครั้งแรก, การรัน `verify.mjs` และไฟล์ที่แก้

**เพิ่ม task** สร้าง `scripts/ab/tasks/<name>.mjs` ที่ export `name`, `prompt`, `probe(dir)` และ `grade(dir)` โดย `probe` คืน `{ ok, detail }` ให้เปิดเซิร์ฟเวอร์ด้วย `withServer` และเรียกด้วย `call` จาก `scripts/ab/lib.mjs` เพื่อให้ harness เป็นเจ้าของพอร์ตและฐานข้อมูล `grade` คืน `{ checks, details }` โดยค่าทุกตัวใน `checks` เป็น boolean ที่ตารางสรุปนับเป็น `3/3` เริ่มจาก `commonGrade(dir)` (เทสผ่าน, guard ผ่าน, หลักฐานสดและครบ) ตรวจ task ด้วย `--dry-run` และเพิ่มเคสใน `tests/ab.test.mjs` ว่าสำเนาที่ไม่แก้ต้องไม่ผ่านและคำตอบที่เขียนเองต้องผ่าน งานแบบรายงานบั๊กให้ export `setup(dir)` ที่ฝังบั๊กด้วย `plantBug(dir, edits, message)` จาก `scripts/ab/lib.mjs` ก่อนเริ่ม session commit นั้นจะติด tag `ab-start` และนับเป็นจุดเริ่ม งานที่ใช้ได้เฉพาะเมื่อมี plugin ให้ export `arms` (เช่น `["full"]`) และงานที่ต้องใช้ tool มากกว่าค่าเริ่มต้นให้ export `allowedTools` และ `addDirs()` task สามารถ export `rubric` ซึ่งเป็น array ของคำถามแบบใช่หรือไม่เกี่ยวกับโค้ดที่ต้องใช้ดุลยพินิจตอบ สำหรับ `--judge` ส่วนอะไรที่ script ตรวจได้ให้อยู่ใน `grade`
