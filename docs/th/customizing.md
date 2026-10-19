# ปรับ Stack Agent ให้เป็นของทีมคุณ

Stack Agent ทำมาให้ fork ไปแก้ หน้านี้บอกว่าแต่ละส่วนอยู่ตรงไหน และแก้อย่างไรโดยไม่ทำให้ส่วนอื่นพัง

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
agents/           judge.md, reviewer.md
hooks/            hooks.json (ผูก scripts/hooks/*.mjs เข้ากับ Claude Code)
skills/<name>/    SKILL.md หนึ่งไฟล์ต่อ skill และ script ที่ skill เรียกใช้
scripts/          guard.mjs, verify.mjs, api-map.mjs, init.mjs, sample-commits.mjs, lib/, hooks/
templates/        common/ (ไฟล์กฎ), ci/ (workflow), presets/<name>/ (config ของ verify และ guard)
examples/         sample-backend (Node HTTP API), sample-cli (Python CLI),
                  sample-library (Node package), sample-frontend (static web app),
                  sample-generic (CSV data job)
evals/            eval case ของ claude plugin eval และ scaffold.mjs
tests/            ชุดเทส node:test สำหรับทุก script และ hook
```

กติกาที่ทำให้ fork ไม่พัง:

- script เป็น Node ESM ธรรมดาและไม่มี dependency เพราะ repo ปลายทางคัดลอกไปไว้ใน `.stack-agent/bin/` และ CI รันได้โดยไม่ต้อง `npm install`
- `init.mjs --check` รายงานไฟล์ที่คัดลอกไว้เป็น `outdated` เมื่อเนื้อหาไม่ตรงกับ `scripts/` ทุก byte ดังนั้นทุกการแก้ script จะไปถึงทีมที่ใช้งานในรูปของคำเตือนให้รัน init ซ้ำ script ใหม่ที่ต้องคัดลอกให้เพิ่มใน `TOOLS` ของ `scripts/init.mjs` และเมื่อออก release ให้เพิ่ม `version` ใน `.claude-plugin/plugin.json` เพราะ init จะเขียนค่านี้ลง `.stack-agent/bin/VERSION`
- ทุกพฤติกรรมของ script มีเทสใน `tests/` ให้รัน `npm test` ทุกครั้งที่แก้
- `claude plugin validate . --strict` ต้องผ่านหลังแก้ `.claude-plugin/`, `skills/`, `agents/` หรือ `hooks/`

## เพิ่ม preset

1. สร้าง `templates/presets/<name>/` ที่มี `verify.json` และ `guard.config.json` ใส่ `api-map.json` เฉพาะ preset ที่ใช้แผนที่ API
2. เก็บกฎสากล (`no-merge-conflict-markers`, `no-private-keys`) ไว้ใน config ของ guard
3. ใส่ `EDIT ME` ในทุกค่าที่ผู้ใช้ต้องกรอก `init.mjs --check` จะรายงานไฟล์ที่ยังมีคำนี้
4. เพิ่มชื่อ preset ในรายการที่คาดไว้ใน `tests/presets.test.mjs` ชุดเทสจะตรวจเองว่า config ของทุก preset โหลดได้
5. เพิ่ม preset ในตารางของ `README.md`, `docs/adoption.md` และ `skills/stack-agent-init/SKILL.md`

ไอเดียที่น่าทำ: `mobile` (คำสั่ง simulator เป็น command check), `data-pipeline` (รันตัวอย่างแล้วเช็กจำนวนแถว), `infra` (`terraform validate` และ `plan` เป็น command check)

## เพิ่มกฎ guard

กฎอยู่ใน `.stack-agent/guard.config.json` ของแต่ละโปรเจค ไม่ได้อยู่ใน repo นี้ ถ้าต้องการให้ทุกโปรเจคในทีมมีกฎนั้น ให้เพิ่มลงใน template ของ preset

- `message` บอกว่าผิดอะไร `fix` บอกชื่อไฟล์ ฟังก์ชัน หรือโมดูลที่ให้ใช้แทน guard จะไม่รับกฎที่ไม่มี `fix`
- พิสูจน์ว่ากฎจับความผิดจริงในอดีตได้ก่อนพึ่งพา (`guard.mjs --strict` หรือ fixture ในเทส)
- กฎ import อ่านได้ทั้ง JS/TS และ Python ภาษาอื่นให้ใช้กฎแบบ `pattern`

ถ้าจะเพิ่ม *แบบ* ของกฎใหม่ (เช่นอ่าน import ของภาษาอื่น) ให้ขยาย `findViolations` ใน `scripts/guard.mjs` ตรวจฟิลด์ใน `loadConfig` และเพิ่มเทสข้างเทสเดิมใน `tests/guard.test.mjs`

## เพิ่ม skill

1. สร้าง `skills/<name>/SKILL.md` พร้อม frontmatter:

   ```markdown
   ---
   name: <name>
   description: ทำอะไร และใช้เมื่อไร รวมคำที่คนมักพิมพ์ ส่วนนี้คือสิ่งที่ Claude ใช้ตัดสินว่าจะหยิบ skill มาใช้หรือไม่
   ---
   ```

2. ใส่ `disable-model-invocation: true` สำหรับ skill ที่คนควรสั่งเอง (เขียนไฟล์หลายจุด ใช้เงิน หรือเปลี่ยนสิ่งที่ใช้ร่วมกัน) และใส่ `user-invocable: false` สำหรับ skill ที่ให้ agent ใช้เองเท่านั้น
3. ทำให้เล็กและต่อกันได้ เช่นเรียก `verify` แทนการเขียนขั้นตอนซ้ำ
4. โค้ดที่ agent ต้องเขียนซ้ำทุกครั้ง ให้เก็บเป็น script ในโฟลเดอร์ของ skill แล้วอ้างด้วย `${CLAUDE_SKILL_DIR}/script.mjs`
5. เพิ่ม eval case (ด้านล่าง) เพื่อวัดว่า skill ช่วยจริงไหม

## แก้นโยบายของ hook

`scripts/hooks/pre-bash.mjs` ตัดสินว่าคำสั่ง shell ไหนถูกปฏิเสธ หรือต้องให้คนอนุมัติ:

- `deny` สำหรับคำสั่งที่ข้ามการตรวจ (`--no-verify`)
- `ask` สำหรับคำสั่งที่ทำลายข้อมูลหรือผ่อนกฎ

path ที่ป้องกันอยู่ใน `scripts/hooks/protected-paths.mjs` ทุก pattern มีแถวใน `tests/hooks.test.mjs` ให้เพิ่มของคุณในเทสก่อน แล้วแก้โค้ดจนผ่าน และเก็บคำสั่งปกติไว้ในรายการ "lets ordinary commands through" เพื่อไม่ให้นโยบายที่เข้มขึ้นไปบล็อกงานปกติ

## เพิ่ม eval case

1. สร้าง `evals/<case>/` ที่มี `case.yaml` (`schema_version: "1.1"`, `name`, `context.scaffold_script: scaffold.sh`), `prompt.md` (คำขอที่เขียนเหมือนผู้ใช้จริงและไม่พูดถึงการทดสอบ) และ `graders/*.md`
2. `scaffold.sh` เรียก `node "$(dirname "$0")/../scaffold.mjs"` ซึ่งคัดลอก `examples/sample-backend` ไปที่โฟลเดอร์ที่ใช้รัน ถ้าจะใช้ตัวอย่างอื่นให้คัดลอกแล้วดัดแปลง
3. ใช้ grader แบบ script (`regex`, `file_exists`, `tool_used`) เป็นหลัก และใช้ `llm` เฉพาะข้อที่ต้องใช้ดุลยพินิจ
4. รัน:

   ```bash
   claude plugin eval . --case <case> --scaffold --runs 1 --no-publish
   ```

   case ที่แก้โค้ดต้องเพิ่ม `--allow-tools Bash Write Edit` และต้องรันบน Linux, macOS หรือ WSL2

## เพิ่มโปรเจคตัวอย่าง

ตัวอย่างใช้เป็น fixture ของเทสด้วย ให้ทำตามโครงของ `examples/sample-cli`: มีซอร์สจริง มีเทสของตัวเอง มี `.stack-agent/` ที่กรอกครบ (ไม่มี `EDIT ME`) และมี `guard-baseline.json` ว่างที่สร้างด้วย `guard.mjs --update-baseline` แล้วเพิ่มไฟล์เทสแบบ `tests/sample-cli.test.mjs` ที่รัน guard และ verify ของตัวอย่าง และเพิ่มขั้นใน CI

## วัดพฤติกรรมของ agent (A/B)

`scripts/ab/run.mjs` รัน task เดียวกันบนสำเนาใหม่ของ `examples/sample-backend` ทั้งแบบมีและไม่มี plugin แล้วตรวจผลด้วย script (HTTP probe อิสระ, เทส, guard, API map และหลักฐานจาก verify) ไม่เชื่อสรุปของ agent เอง คำสั่งนี้เรียก `claude -p` จึงเสียเงินจริง

```bash
npm run ab -- --task endpoint --task validate --arms full,none --runs 3 --model sonnet --budget 1
```

| ตัวเลือก | ความหมาย |
| --- | --- |
| `--task NAME` | task ใน `scripts/ab/tasks/` (`endpoint`, `validate`) ใส่ซ้ำได้หลายตัว จำเป็นต้องมี |
| `--arms` | รายการคั่นด้วย comma จาก `full` (plugin ตามเดิม), `none` (ไม่มี plugin), `hooks-only` (สำเนาที่ไม่มี `skills/`), `skills-only` (สำเนาที่ไม่มี `hooks/hooks.json`) ค่าเริ่มต้น `full,none` |
| `--runs N` | จำนวนรอบต่อ task และ arm ค่าเริ่มต้น 1 |
| `--model`, `--budget USD` | ต้องระบุทั้งคู่ งบเป็นเพดานต่อรอบ ส่งเป็น `--max-budget-usd` และไม่มีค่าเริ่มต้นโดยตั้งใจ |
| `--plugin DIR`, `--out DIR` | plugin ที่จะทดสอบ (ค่าเริ่มต้นคือ repo นี้) และที่เก็บผล (ค่าเริ่มต้นคือโฟลเดอร์ใหม่ใน temp ของระบบ) |
| `--no-isolate` | ไม่ส่ง `--setting-sources project,local --strict-mcp-config` ปกติจะแยกให้เสมอ |
| `--dry-run` | สร้างโปรเจคและตรวจสำเนาที่ยังไม่แก้ ไม่เรียก `claude` ไม่เสียเงิน ใช้เช็ก task ใหม่ |
| `--json` | พิมพ์ผลเป็น JSON แทนตารางสรุป |

**ค่าใช้จ่าย** วัดกับ Sonnet แล้วรอบละประมาณ $0.25 ถึง $0.45 ดังนั้น `--runs 3` กับ 2 task และ 2 arm อยู่ราว $3 ถึง $5 ลอง `--dry-run` ก่อน

**การแยกสภาพแวดล้อม** plugin และ settings ของคุณเองจะปนเข้าไปทั้งสองฝั่งถ้าไม่แยก จึงใช้ `--setting-sources project,local` และ `--strict-mcp-config` (ไม่โหลด MCP server ของผู้ใช้) ทุกรอบ และ harness อ่าน event `system/init` ของทุก transcript รอบที่ผิดเงื่อนไขจะถูกตั้งเป็น `invalid` ตัดออกจากตารางสรุป แจ้งเตือนดังๆ และ exit code เป็น 1 เมื่อ arm ที่มี plugin โหลด plugin อื่นนอกจาก `stack-agent`, arm `none` โหลด plugin ใดๆ, `hooks-only` ยังเห็น skill `stack-agent:` หรือ `skills-only` ยังเห็น hook ของ Stack Agent ทำงาน plugin ที่มากับ Claude Code (`@builtin`) ไม่นับ

**สิ่งที่บันทึก** ใน `<out>/results.json` ทุกรอบ: git SHA ของ plugin และ worktree สกปรกหรือไม่, เวอร์ชัน harness, `claude --version`, model, arm, task, prompt, งบ, เวลาเริ่มและจบ, ค่าใช้จ่ายและจำนวน turn, จำนวน hook feedback กับบรรทัดแรก, skill ที่ agent เรียก, ผลการแยกสภาพแวดล้อม และผลของทุก grader ส่วน transcript ดิบอยู่ที่ `<out>/runs/<task>-<arm>-<n>.jsonl` และโปรเจคของแต่ละรอบอยู่ที่ `<out>/projects/` ดูว่า agent ทำอะไรจริงๆ ด้วย:

```bash
node scripts/ab/inspect.mjs <out>/runs
```

จะแสดง skill ที่เรียก, feedback จาก Stop hook ว่ามาก่อนหรือหลังการแก้ `verify.json` ครั้งแรก, การรัน `verify.mjs` และไฟล์ที่แก้

**เพิ่ม task** สร้าง `scripts/ab/tasks/<name>.mjs` ที่ export `name`, `prompt`, `probe(dir)` และ `grade(dir)` โดย `probe` คืน `{ ok, detail }` ให้เปิดเซิร์ฟเวอร์ด้วย `withServer` และเรียกด้วย `call` จาก `scripts/ab/lib.mjs` เพื่อให้ harness เป็นเจ้าของพอร์ตและฐานข้อมูล `grade` คืน `{ checks, details }` โดยค่าทุกตัวใน `checks` เป็น boolean ที่ตารางสรุปนับเป็น `3/3` เริ่มจาก `commonGrade(dir)` (เทสผ่าน, guard ผ่าน, หลักฐานสดและครบ) ตรวจ task ด้วย `--dry-run` และเพิ่มเคสใน `tests/ab.test.mjs` ว่าสำเนาที่ไม่แก้ต้องไม่ผ่านและคำตอบที่เขียนเองต้องผ่าน
