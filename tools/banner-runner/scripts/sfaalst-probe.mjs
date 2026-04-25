import { chromium } from "playwright";
import fs from "node:fs/promises";

const storageState = "/home/uvan/banner-docente-runner/storage/auth/banner-storage-state.json";
const baseUrl = "https://genesisadmin.uniminuto.edu";
const loginUrl = `${baseUrl}/applicationNavigator/seamless`;
const messageUrl = `${baseUrl}/BannerAdmin.ws/rest-services/message/`;
const warmupUrl =
  `${baseUrl}/BannerAdmin/?form=SSASECT&ban_args=&ban_mode=xe` +
  "#eyJ0eXBlIjoiY29udGV4dCIsImNvbnRleHQiOnsicGFnZU5hbWUiOiJTU0FTRUNUIiwidmFsdWVzIjp7fSwiaG9zdCI6Imh0dHBzOi8vZ2VuZXNpc2FkbWluLnVuaW1pbnV0by5lZHUvYXBwbGljYXRpb25OYXZpZ2F0b3IiLCJhcHBpZCI6ImJhbm5lckhTIiwicGxhdGZvcm0iOiJiYW5uZXJIUyJ9fQ==";

function control(response) {
  return response?.header?.[0]?.control?.[0] ?? null;
}

function blocks(response) {
  return response?.body?.[0]?.block ?? [];
}

function workspaceInitPayload(form) {
  return {
    header: [
      {
        control: [
          {
            action: [
              {
                parameter: [
                  { "@datatype": "String", "@value": form, "@name": "form" },
                  { "@datatype": "String", "@value": "true", "@name": "ban_args" },
                  { "@datatype": "String", "@value": "xe", "@name": "ban_mode" }
                ],
                "@validateNewRow": false,
                "@taskValidation": false,
                "@recordValidation": false,
                "@validation": true,
                "@kind": "Action",
                "@name": "WORKSPACE_INIT"
              }
            ],
            "@isSuspended": "false",
            "@modal": "false",
            "@isChanged": "false"
          }
        ]
      }
    ]
  };
}

function callFormPayload(guainitTaskId, form) {
  return {
    header: [
      {
        control: [
          {
            action: [
              {
                "@validateNewRow": false,
                "@taskValidation": false,
                "@recordValidation": false,
                "@validation": true,
                "@kind": "Action",
                "@name": "CALL_FORM",
                "@item": "MENU_TREE",
                "@block": "$MAIN$_BLOCK"
              }
            ],
            "@isSuspended": "false",
            "@modal": "false",
            "@isChanged": "false",
            "@task": guainitTaskId,
            "@taskName": "GUAINIT",
            "@item": "MENU_TREE",
            "@block": "$MAIN$_BLOCK"
          }
        ]
      }
    ],
    body: [
      {
        callForm: [
          {
            "@taskName": form,
            parameters: [
              {
                parameter: [
                  { "@name": "ban_args", "@value": "true" },
                  { "@name": "ban_mode", "@value": "xe" }
                ]
              }
            ]
          }
        ]
      }
    ]
  };
}

function unlockGlobalsPayload(guainitTaskId) {
  return {
    header: [
      {
        control: [
          {
            action: [
              {
                "@validateNewRow": false,
                "@taskValidation": false,
                "@recordValidation": false,
                "@validation": true,
                "@kind": "Action",
                "@name": "UNLOCK_GLOBALS",
                "@item": "MENU_TREE",
                "@block": "$MAIN$_BLOCK"
              }
            ],
            "@isSuspended": "false",
            "@modal": "false",
            "@isChanged": "false",
            "@task": guainitTaskId,
            "@taskName": "GUAINIT",
            "@item": "MENU_TREE",
            "@block": "$MAIN$_BLOCK"
          }
        ]
      }
    ]
  };
}

function nextBlockPayload(taskId, period, nrc) {
  return {
    header: [
      {
        control: [
          {
            action: [
              {
                "@validateNewRow": false,
                "@taskValidation": false,
                "@recordValidation": false,
                "@validation": true,
                "@kind": "Action",
                "@name": "NEXT_BLOCK",
                "@item": "EXECUTE_BTN",
                "@block": "KEY_BLOCK"
              }
            ],
            "@isSuspended": "false",
            "@modal": "false",
            "@isChanged": "false",
            "@task": taskId,
            "@taskName": "SFAALST",
            "@item": "EXECUTE_BTN",
            "@block": "KEY_BLOCK"
          }
        ]
      }
    ],
    body: [
      {
        block: [
          {
            "@name": "KEY_BLOCK",
            record: [
              {
                "@id": "",
                item: [
                  {
                    "@name": "SSBSECT_TERM_CODET",
                    value: period
                  },
                  {
                    "@name": "SSBSECT_CRNT",
                    value: nrc
                  }
                ],
                "@status": "C"
              }
            ]
          }
        ]
      }
    ]
  };
}

function closeAlertPayload(taskId, variant) {
  const action = {
    "@validateNewRow": false,
    "@taskValidation": false,
    "@recordValidation": false,
    "@validation": false,
    "@kind": "Action",
    "@name": "CLOSE_ALERT"
  };

  if (variant !== "application-exact") {
    action["@item"] = "SSBSECT_TERM_CODET";
    action["@block"] = "KEY_BLOCK";
  }

  if (variant === "param-name") {
    action.parameter = [{ "@datatype": "string", "@value": "S$_GRADE_COMPONENTS", "@name": "name" }];
  }

  const payload = {
    header: [
      {
        control: [
          {
            action: [action],
            "@isSuspended": "false",
            "@modal": "false",
            "@isChanged": "false",
            "@task": taskId,
            "@taskName": "SFAALST",
            "@item": "SSBSECT_TERM_CODET",
            "@block": "KEY_BLOCK"
          }
        ]
      }
    ]
  };

  if (variant === "body-name" || variant === "body-name-button" || variant === "application-exact") {
    payload.body = [
      {
        alert: [
          variant === "body-name-button"
            ? {
                "@name": "S$_GRADE_COMPONENTS",
                buttons: [{ button: [{ "@index": "0", "@action": "CLOSE_ALERT" }] }]
              }
            : variant === "application-exact"
              ? {
                  "@name": "S$_GRADE_COMPONENTS",
                  selected: [{ value: "0" }]
                }
            : {
                "@name": "S$_GRADE_COMPONENTS"
              }
        ]
      }
    ];
  }

  return payload;
}

async function main() {
  const browser = await chromium.launch({ headless: true, channel: "msedge" }).catch(() =>
    chromium.launch({ headless: true })
  );
  const context = await browser.newContext({ storageState });
  const page = await context.newPage();

  page.setDefaultNavigationTimeout(30000);
  page.setDefaultTimeout(10000);

  await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  console.log("loginUrl", page.url());
  await page.goto(warmupUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  console.log("warmupUrl", page.url());

  async function send(payload, label) {
    const response = await page.context().request.post(messageUrl, {
      headers: {
        accept: "application/json, text/plain, */*",
        "content-type": "application/json"
      },
      data: payload,
      failOnStatusCode: false
    });

    const text = await response.text();
    console.log(label, "status", response.status(), "ok", response.ok(), "len", text.length);
    console.log(label, "snippet", text.slice(0, 300).replace(/\s+/g, " "));
    return { status: response.status(), ok: response.ok(), text };
  }

  const form = process.argv[2] || "SFAALST";
  const formKey = form.toLowerCase();
  const workspaceRaw = await send(workspaceInitPayload(form), "workspace");
  await fs.writeFile(`/tmp/${formKey}-workspace-raw.txt`, workspaceRaw.text);
  if (!workspaceRaw.text.trim()) {
    throw new Error("WORKSPACE_INIT devolvio respuesta vacia");
  }
  const workspace = JSON.parse(workspaceRaw.text);
  const guainitTaskId = control(workspace)?.["@task"];
  console.log("workspaceControl", control(workspace));
  if (!guainitTaskId) {
    throw new Error("No fue posible resolver GUAINIT");
  }

  const callFormRaw = await send(callFormPayload(guainitTaskId, form), "callForm");
  await fs.writeFile(`/tmp/${formKey}-callform-raw.txt`, callFormRaw.text);
  if (!callFormRaw.text.trim().startsWith("<")) {
    const callForm = JSON.parse(callFormRaw.text);
    console.log("callFormControl", control(callForm));
    console.log("callFormBlocks", blocks(callForm).map((block) => block["@name"]));
  }

  const unlockRaw = await send(unlockGlobalsPayload(guainitTaskId), "unlock");
  await fs.writeFile(`/tmp/${formKey}-unlock-raw.txt`, unlockRaw.text);
  if (!unlockRaw.text.trim().startsWith("<")) {
    const unlock = JSON.parse(unlockRaw.text);
    console.log("unlockControl", control(unlock));
    console.log("unlockBlocks", blocks(unlock).map((block) => block["@name"]));

    if (form === "SFAALST") {
      const taskId = control(unlock)?.["@task"];
      const period = process.argv[3] || "202615";
      const nrc = process.argv[4] || "72307";
      if (taskId) {
        const nextBlockRaw = await send(nextBlockPayload(taskId, period, nrc), "nextBlock");
        await fs.writeFile(`/tmp/${formKey}-nextblock-raw.txt`, nextBlockRaw.text);
        if (!nextBlockRaw.text.trim().startsWith("<") && nextBlockRaw.text.trim()) {
          const nextBlock = JSON.parse(nextBlockRaw.text);
          console.log("nextBlockControl", control(nextBlock));
          console.log("nextBlockBlocks", blocks(nextBlock).map((block) => block["@name"]));

          const alerts = nextBlock.body?.[0]?.alert ?? [];
          if (alerts.length > 0) {
            for (const variant of ["plain", "param-name", "body-name", "body-name-button", "application-exact"]) {
              const closeRaw = await send(closeAlertPayload(taskId, variant), `closeAlert:${variant}`);
              await fs.writeFile(`/tmp/${formKey}-closealert-${variant}.raw.txt`, closeRaw.text);
              if (!closeRaw.text.trim().startsWith("<") && closeRaw.text.trim()) {
                const closeResponse = JSON.parse(closeRaw.text);
                console.log(
                  `closeAlert:${variant}:blocks`,
                  blocks(closeResponse).map((block) => block["@name"])
                );
              }
            }
          }
        }
      }
    }
  }

  await context.close();
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
