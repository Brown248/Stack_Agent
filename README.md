# Stack Agent

Claude Code plugin ที่เปลี่ยน "ความรู้ในหัวและใน prompt" ให้เป็นระบบที่บังคับใช้ได้จริงใน backend repo ตามสรุปจาก 3 คลิป (Lauren Tan / pstack และวิธีของวิศวกร Anthropic) ได้แก่ verification ที่มีหลักฐาน, guard ที่ห้ามพลาด (hook + CI แบบ ratchet), แผนที่ API ที่ตรวจ drift ได้, skill เล็กที่มี script, judge แยกตัว และ evals

> ดู [docs/traceability.md](docs/traceability.md) ว่าแต่ละข้อในสรุปถูกทำเป็นไฟล์ไหน ตรวจสอบอย่างไร และอะไรที่ยังไม่ได้ทำพร้อมเหตุผล

## ทำอะไรได้บ้าง

| ชั้น | ไฟล์ | หน้าที่ |
| --- | --- | --- |
| Verification | `scripts/verify.mjs`, skill `verify-api` | รันเทส เปิด server จริง ยิง endpoint ตาม `verify.json` แล้วเขียนหลักฐานลง `.stack-agent/evidence/` |
| Hard constraint (CI) | `scripts/guard.mjs` | กฎห้ามพลาดแบบ regex, import ต้องห้าม, ขอบเขตโมดูล พร้อม baseline แบบ ratchet: ของเก่าผ่าน ของใหม่ต้องไม่เพิ่ม |
| Hard constraint (ตอนทำงาน) | `hooks/hooks.json` | ดักคำสั่ง Bash/PowerShell: บล็อกการปิด git hook (`--no-verify`, `-n`, `HUSKY=0`, `core.hooksPath`), ถามก่อน force-push / ลบ branch / `reset --hard` / `clean -f` / ยกระดับ baseline / แก้ไฟล์ของ guard; รัน guard ทุกครั้งที่ Edit/Write; เตือนครั้งเดียวถ้าจะจบงานโดยไม่มีหลักฐาน verify แบบเต็ม ดักด้วยการอ่าน pattern จึงไม่ครอบคลุมทุกรูปแบบ CI คือด่านสุดท้าย |
| Soft constraint | `.stack-agent/rules.md` (template) | วิธีเขียนที่ทีมชอบ ยืดหยุ่นได้ |
| Feature Map → API map | `scripts/api-map.mjs`, skill `api-map` | ร่างแผนที่จากโค้ด, ตรวจว่าแผนที่ตรงกับ route จริง, เตือน endpoint ที่ยังไม่มี verify check |
| Skills | `skills/*/SKILL.md` | `add-endpoint`, `add-migration`, `verify-api`, `api-map`, `correct`, `reflect`, `sample-review`, `run-evals`, `stack-agent-init` |
| Subagents | `agents/judge.md`, `agents/reviewer.md` | judge ให้คะแนนตาม rubric อย่างเดียว, reviewer ตรวจ diff ก่อนส่งคน ทั้งคู่ห้ามแก้ไฟล์ |
| Evals | `evals/*` | `claude plugin eval` เทียบผลแบบมีและไม่มี plugin (Δ) |

## ติดตั้ง

```bash
claude plugin marketplace add Brown248/Stack_Agent
```

```bash
claude plugin install stack-agent@stack-agent-marketplace
```

ทดลองจากเครื่องโดยไม่ต้อง push ให้ใช้ path ของ repo แทน เช่น `claude plugin marketplace add D:/Stack_Agent`

ใน Claude Code คำสั่งของ plugin จะมี prefix เช่น `/stack-agent:stack-agent-init`

## เริ่มใช้กับ backend repo

เปิด Claude Code ใน backend repo แล้วพิมพ์ `/stack-agent:stack-agent-init` skill จะพาทำตามลำดับในสรุป:

1. **Verification:** กรอก `.stack-agent/verify.json` จนรัน `node .stack-agent/bin/verify.mjs` แล้วได้ `verify: ok`
2. **Guard:** ใส่กฎห้ามพลาด 3–5 ข้อใน `.stack-agent/guard.config.json` แล้วรัน `--update-baseline` ครั้งแรกเพื่อบันทึกของเก่า
3. **แผนที่ API:** `api-map.mjs --draft` ให้ AI ร่าง แล้วคนตรวจแถวที่ยังเป็น `TODO`
4. **Skills:** ใช้ `add-endpoint`, `add-migration` และเพิ่ม skill ของงานที่ทีมทำบ่อย
5. **Evals:** รันเมื่อมี skill ให้วัดแล้ว (`/stack-agent:run-evals`)

รายละเอียดทีละขั้นอยู่ใน [docs/adoption.md](docs/adoption.md)

`init.mjs` คัดลอก script ไปไว้ที่ `.stack-agent/bin/` ของ repo ปลายทาง เพื่อให้ CI รันได้โดยไม่ต้องมี plugin และเพิ่ม `.github/workflows/stack-agent.yml` ให้ถ้ายังไม่มี

## ข้อกำหนด

- Node.js 22 ขึ้นไปในเครื่องและใน CI (script ไม่มี dependency) ทดสอบจริงแล้วบน Node 25.9 / Windows 11 ส่วน Node 22/24 บน Linux และ Windows ตั้งไว้ใน CI แล้วแต่ยังไม่ได้รันจริง
- Claude Code v2.1.269 ขึ้นไปสำหรับ `claude plugin eval`
- กฎแบบ `forbidden-import` และ `module-boundary` อ่าน import ของ JS/TS เท่านั้น ส่วนกฎแบบ `pattern` ใช้ได้กับทุกภาษา

## โครงสร้าง repo

```
.claude-plugin/   plugin.json, marketplace.json
agents/           judge.md, reviewer.md
hooks/            hooks.json
skills/           9 skills
scripts/          guard.mjs, verify.mjs, api-map.mjs, init.mjs, sample-commits.mjs, hooks/, lib/
templates/        config ตั้งต้นที่ init.mjs คัดลอกไปให้ repo ปลายทาง
examples/         sample-backend: backend ตัวอย่างที่ติดตั้งครบ ใช้เป็น fixture ของเทสและ evals
evals/            4 eval cases + scaffold.mjs
tests/            node:test 93 เทส ครอบคลุมทุก script และ hook
docs/             traceability.md, adoption.md
```

## พัฒนา plugin นี้

```bash
npm test
```

```bash
claude plugin validate . --strict
```

กติกาสำหรับคน/AI ที่แก้ repo นี้อยู่ใน `.claude/CLAUDE.md`

## สิ่งที่ตั้งใจยังไม่ทำ

ตามสรุป: ยังไม่ทำ auto-merge และ outer loop (ดึงงานจาก Slack/Linear อัตโนมัติ) เพราะ repo ที่จะใช้มีทีมอื่นใช้ร่วมด้วย เริ่มจาก AI ทำแล้วคนรีวิวก่อน เหตุผลของแต่ละข้ออยู่ใน [docs/traceability.md](docs/traceability.md)
