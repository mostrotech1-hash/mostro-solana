# @mostro/ui

Shared UI kit for the Mostro fronts. It is a Nuxt layer: a front uses it with `extends: ["../ui"]`, and every component below is auto-imported.

| Component   | Use                                                                                   |
| ----------- | ------------------------------------------------------------------------------------- |
| `UiButton`  | `variant`: `primary` (lime), `dark`, `secondary`, `social`, `link`. Also `to`/`href`. |
| `UiInput`   | Labelled text input (`v-model`).                                                      |
| `UiCard`    | `variant`: `lime` (pass card), `dark` (panels), `plain` (centered card).              |
| `UiRow`     | Label on the left, value on the right.                                                |
| `UiSection` | Section title above a list of rows.                                                   |
| `UiStepper` | Step bar for the account flow.                                                        |
| `UiTopBar`  | Page header: back arrow, logo, title, right slot. Logo only on desktop.               |
| `UiSheet`   | Bottom sheet on mobile, modal on desktop.                                             |
| `UiStatus`  | Centered status screen with the Mo mascot (paying, cancelled, slow).                  |
| `UiAvatar`  | Profile picture with initials fallback.                                               |
| `UiBadge`   | Small pill label.                                                                     |

Design tokens (colors, radius, font) live in `assets/css/tokens.css`. Brand images are in `assets/images/`. The tab icon is `public/favicon.ico`; every front that extends this layer shows it.
