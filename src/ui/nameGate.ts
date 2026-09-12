import {
  MAX_NAME_LENGTH,
  type Player,
  loadPlayer,
  normalizeName,
  savePlayer,
} from '../services/player';

/**
 * The name dialog, in both of its modes: the first-visit gate and a later
 * rename.
 *
 * It is plain DOM, not a Phaser scene, on purpose: a canvas cannot host a text
 * field, and Korean input needs a real `<input>` for the IME to compose into.
 * The markup lives in `index.html`; this module only wires it up.
 */

interface DialogOptions {
  readonly title: string;
  readonly value: string;
  /** The gate has nothing to fall back to, so only a rename can be dismissed. */
  readonly cancellable: boolean;
}

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`Missing #${id} in index.html`);
  return found as T;
}

/** Resolves with the accepted name, or null when the player backed out. */
async function openDialog(options: DialogOptions): Promise<string | null> {
  const gate = element('welcome');
  const form = element<HTMLFormElement>('welcome-form');
  const title = element('welcome-title');
  const input = element<HTMLInputElement>('welcome-name');
  const cancel = element<HTMLButtonElement>('welcome-cancel');
  const error = element('welcome-error');

  title.textContent = options.title;
  input.maxLength = MAX_NAME_LENGTH;
  input.value = options.value;
  cancel.hidden = !options.cancellable;
  error.hidden = true;
  gate.hidden = false;
  input.focus();
  input.select();

  return new Promise<string | null>((resolve) => {
    // Both handlers are removed on the way out. Leaving them attached would
    // stack another listener on every rename, and a later submit would then
    // resolve a promise nobody is waiting on.
    const close = (result: string | null) => {
      form.removeEventListener('submit', onSubmit);
      cancel.removeEventListener('click', onCancel);
      gate.hidden = true;
      resolve(result);
    };

    const onSubmit = (event: Event) => {
      event.preventDefault();
      const name = normalizeName(input.value);
      if (name === null) {
        error.textContent = '이름을 한 글자 이상 입력해주세요.';
        error.hidden = false;
        input.focus();
        return;
      }
      close(name);
    };

    const onCancel = () => close(null);

    form.addEventListener('submit', onSubmit);
    cancel.addEventListener('click', onCancel);
  });
}

/**
 * Resolve with the player this browser belongs to, asking for a name first if
 * it has never been here. Boot the game only after this settles — the HUD shows
 * the name, so there is nothing to render until it is known.
 */
export async function ensurePlayer(): Promise<Player> {
  const known = loadPlayer();
  if (known !== null) return known;

  const name = await openDialog({
    title: '이름을 정해주세요',
    value: '',
    cancellable: false,
  });
  // Not cancellable, so `name` is never null here.
  return savePlayer(name ?? '');
}

/**
 * Rename the current player, keeping their id — the personal best stays theirs.
 * Resolves with the unchanged player when the dialog is dismissed.
 */
export async function renamePlayer(current: Player): Promise<Player> {
  const name = await openDialog({
    title: '이름 변경',
    value: current.name,
    cancellable: true,
  });
  return name === null ? current : savePlayer(name);
}
