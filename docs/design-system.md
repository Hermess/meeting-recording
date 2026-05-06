# Meeting AI Kit Design System

## Design Direction

Meeting AI Kit should feel like a focused meeting workspace, closer to Feishu Minutes than to an admin dashboard. The product starts from a file/workbench mental model: users open the app, find meeting records, start recording, upload or paste transcripts, review minutes, and publish.

The UI should stay quiet, operational, and dense enough for repeated work. Avoid marketing-style hero sections, decorative cards, and oversized typography.

## Layout

- Use a persistent left sidebar for primary navigation.
- Use a top utility bar with search as the main orientation control.
- Main content is a white work surface with light dividers, not floating page cards.
- Primary actions sit in the page toolbar, usually top right.
- Settings are secondary and should not dominate the product home.

### Desktop Shell

- Sidebar width: `248px`.
- Top bar height: `72px`.
- Main content padding: `32px 40px`.
- Sidebar background: `#f7f9fc`.
- Main background: `#ffffff`.
- Border color: `#e5e8ef`.

## Navigation

Primary nav items:

- `主页`: meeting file list and launch actions.
- `录音 / 导入`: create a meeting, start recording, upload or paste transcript.
- `设置`: configuration center.

Navigation rows use icons, label text, and selected state. Selected state uses blue text and a pale blue background.

## Color Tokens

- Text primary: `#1f2329`
- Text secondary: `#646a73`
- Text tertiary: `#8f959e`
- Border: `#e5e8ef`
- Surface sidebar: `#f7f9fc`
- Surface muted: `#f5f7fa`
- Brand blue: `#3370ff`
- Brand purple: `#7b61ff`
- Brand gradient: `linear-gradient(135deg, #3370ff 0%, #7b61ff 100%)`
- Success: `#00a870`
- Warning: `#f5a623`
- Danger: `#f54a45`

## Typography

- Font stack: system Chinese UI fonts.
- Page title: `28px`, weight `600`.
- Section title: `18px`, weight `600`.
- Body: `14px`, line height `1.7`.
- Table header: `13px`, weight `600`, secondary color.
- Do not use negative letter spacing.

## Buttons

- Primary button: gradient or brand blue, white text, 8px radius, 40px height.
- Secondary button: white background, border, 40px height.
- Danger button: white background with danger border/text for destructive actions.
- Icon buttons should be square or compact with accessible text if the icon is not obvious.

## Tables And Lists

Meeting records should appear as a file list:

- Header row: file, project/owner, status, updated time, action.
- Row height: 64px minimum.
- Row hover: pale blue or muted surface.
- Title is the main click target.
- Status is a compact pill, not a large card.

Empty states use a small illustration area and one concise line. Do not add long explanations.

## Forms

Configuration and creation forms should appear in dialogs or focused panels. Avoid showing every configuration at once unless the user is in Settings.

Field rules:

- Use selects for existing configuration choices.
- Use read-only fields when a value is derived from another selection.
- API keys and tokens are password fields.
- Configurations that affect external services should be testable before save.

## Meeting Workflow Pages

### Dashboard

Dashboard is the home file list:

- Top toolbar: title `主页`, actions `录音`, `上传/导入`, `个人热词`.
- Filter row: project, meeting type, recent updated.
- Table/list below.
- Empty state centered in the list area.

### Live Page

Live page is the recording console:

- Left: transcript stream as a non-editable running text surface.
- Right: recording controls, ASR status, mic device, fallback paste.
- Primary action: `开始录音并转写`.

### Review Page

Review page is the minutes editor:

- Center: editable Markdown.
- Right: actions for sync structured data, render visual, export Word/PNG, publish Feishu.
- JSON is hidden behind a debug disclosure.

### Settings

Settings is a configuration center:

- Keep ASR, model gateway library, meeting types, Feishu in separate sections.
- Model gateway library stores actual provider URL/API key/model.
- Meeting types reference saved model gateway configuration by display name.

## Interaction Rules

- New meetings choose a meeting type; the type determines default model, template, and archive folder.
- Realtime ASR transcript is not edited in Live.
- Minutes are edited as Markdown in Review.
- Long image, Word, and Feishu publish consume structured JSON, so changed Markdown must be synced before publishing.

## Responsive Rules

- On desktop, keep sidebar visible.
- On smaller screens, sidebar can collapse above content as horizontal navigation.
- Tables may become stacked rows, but primary actions must remain visible.
