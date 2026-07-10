import type { BreedId, PatronKind } from './types'

export interface BreedMeta {
  name: string
  weightClass: 'courier' | 'light' | 'middle' | 'heavy'
  dispatchPower: number
  combatPower: number
}

export const BREEDS: Record<BreedId, BreedMeta> = {
  winchester:        { name: 'Winchester',        weightClass: 'courier', dispatchPower: 1.4, combatPower: 0.6 },
  greyling:          { name: 'Greyling',           weightClass: 'courier', dispatchPower: 1.2, combatPower: 0.8 },
  'grey-copper':     { name: 'Grey Copper',        weightClass: 'light',   dispatchPower: 1.0, combatPower: 1.0 },
  'yellow-reaper':   { name: 'Yellow Reaper',      weightClass: 'middle',  dispatchPower: 0.9, combatPower: 1.2 },
  longwing:          { name: 'Longwing',           weightClass: 'middle',  dispatchPower: 0.8, combatPower: 1.5 },
  'chequered-nettle':{ name: 'Chequered Nettle',   weightClass: 'heavy',   dispatchPower: 0.7, combatPower: 1.3 },
  kazilik:           { name: 'Kazilik',            weightClass: 'heavy',   dispatchPower: 0.6, combatPower: 1.6 },
}

export interface OfficerNameEntry { name: string; gender: 'm' | 'f' }

export const OFFICER_NAMES: OfficerNameEntry[] = [
  { name: 'William Ashworth', gender: 'm' },
  { name: 'Henry Carrow', gender: 'm' },
  { name: 'Thomas Pemberton', gender: 'm' },
  { name: 'George Blackwood', gender: 'm' },
  { name: 'Edward Sinclair', gender: 'm' },
  { name: 'Charles Hartley', gender: 'm' },
  { name: 'Robert Colborne', gender: 'm' },
  { name: 'James Rutherford', gender: 'm' },
  { name: 'Frederick Yarrow', gender: 'm' },
  { name: 'Arthur Marchmont', gender: 'm' },
  { name: 'Richard Vane', gender: 'm' },
  { name: 'Samuel Ashby', gender: 'm' },
  { name: 'Nathaniel Trevelyan', gender: 'm' },
  { name: 'Augustus Kestrel', gender: 'm' },
  { name: 'Barnaby Bramwell', gender: 'm' },
  { name: 'Cornelius Ledbury', gender: 'm' },
  { name: 'Charlotte Norcross', gender: 'f' },
  { name: 'Eleanor Pellew', gender: 'f' },
  { name: 'Margaret Sutcliffe', gender: 'f' },
  { name: 'Catherine Chamberlayne', gender: 'f' },
  { name: 'Harriet Everard', gender: 'f' },
  { name: 'Sophia Rowntree', gender: 'f' },
  { name: 'Emily Harker', gender: 'f' },
  { name: 'Louisa Winslow', gender: 'f' },
  { name: 'Georgiana Bexley', gender: 'f' },
  { name: 'Amelia Thorncliffe', gender: 'f' },
  { name: 'Frances Marrow', gender: 'f' },
  { name: 'Henrietta Gale', gender: 'f' },
  { name: 'Beatrice Fitzwilliam', gender: 'f' },
  { name: 'Cecilia Wren', gender: 'f' },
  { name: 'Augusta Bramfield', gender: 'f' },
  { name: 'Isabella Cross', gender: 'f' },
]

export const DRAGON_NAMES: Record<BreedId, string[]> = {
  winchester: ['Skit', 'Nimble', 'Wisp', 'Flit', 'Dash'],
  greyling: ['Slate', 'Ashwing', 'Fern', 'Bramble', 'Pike'],
  'grey-copper': ['Copperhead', 'Vex', 'Ember', 'Rust', 'Talon'],
  'yellow-reaper': ['Meadow', 'Saffron', 'Harvest', 'Bramblewing', 'Goldenrod'],
  longwing: ['Valorous', 'Seraphine', 'Lucidia', 'Aurelia', 'Vindex'],
  'chequered-nettle': ['Nettlesting', 'Bramblethorn', 'Wasp', 'Prickle', 'Thistledown'],
  kazilik: ['Emberclaw', 'Cinderjaw', 'Pyra', 'Scorch', 'Vulcan'],
}

export interface PatronDef { name: string; kind: PatronKind; tier: number; goodwill: number; memory: string }

export const PATRON_DEFS: PatronDef[] = [
  {
    name: 'Lady Allendale',
    kind: 'gratitude',
    tier: 1,
    goodwill: 4,
    memory: "She recalls your father's kindness at Trafalgar and means to repay it.",
  },
  {
    name: 'Lord Barham',
    kind: 'transactional',
    tier: 0,
    goodwill: 0,
    memory: 'He expects results in exchange for his continued patronage — nothing more.',
  },
  {
    name: 'Captain Rankin',
    kind: 'rival',
    tier: -1,
    goodwill: 0,
    memory: 'He has never forgiven you for besting him at the Longwing trials.',
  },
]

export type LogContext =
  | 'feeding'
  | 'training'
  | 'gossip'
  | 'wounded'
  | 'funeral'
  | 'war-low'
  | 'war-mid'
  | 'war-high'

export const LOG_LINES: Record<LogContext, string[]> = {
  feeding: [
    'The beasts take their cattle before dawn, lowing complaints into the mist.',
    'Ground crew haul the feed carts up from the coast road, grumbling as ever.',
    "A dragon's appetite is a covert's truest expense, and never once forgiven.",
    'The larder runs thin again; someone must ride for more before nightfall.',
    'Feeding time draws the whole covert out, officers and ensigns alike.',
  ],
  training: [
    'Formation drill again, the dragons wheeling low over the practice field.',
    'A midwingman barks orders that the beasts, for once, deign to obey.',
    'Aerial tactics chalked on a slate, rubbed out and chalked again.',
    'The captains run their crews through boarding drills until dusk.',
    'Even a green dragon learns discipline, given enough patient shouting.',
  ],
  gossip: [
    'Word from the coaching inn: another covert lost a Yellow Reaper to fever.',
    "The officers' mess hums with talk of who dines with which patron.",
    'A letter arrives bearing news no one quite believes, and everyone repeats.',
    'Rumour has it the Admiralty means to reshuffle the coverts again.',
    'Someone swears they saw a French courier-beast over the coast last week.',
  ],
  wounded: [
    "The surgeon's tent smells of vinegar and burnt feathers tonight.",
    'A dragon favours its wing, wincing when the ground crew draw near.',
    "Bandages and bone-set salve; the covert's quiet work goes on.",
    'An officer limps back from drill, waving off concern he plainly needs.',
    'The healer mutters that rest, not medicine, is the only real cure.',
  ],
  funeral: [
    'The covert stands bareheaded as the bell tolls for the fallen.',
    'A name is read aloud, and the dragons keen low in the evening air.',
    'They bury what can be buried and remember the rest in silence.',
    "No parade for this one — just an empty chair at the officers' table.",
    "The chaplain's words are brief; grief here has little patience for speeches.",
  ],
  'war-low': [
    'Newspapers speak of the war as a distant, manageable nuisance.',
    'The Channel patrols report nothing but grey water and gulls.',
    "Whitehall's dispatches remain calm, almost bored, this week.",
    "Talk of Bonaparte is idle talk still, more habit than alarm.",
    "The coast watch keeps its long, uneventful vigil.",
  ],
  'war-mid': [
    'Dispatches grow terser; the Admiralty wants dragons, not excuses.',
    'A neighbouring covert has been called up early, and no one says why.',
    'The papers now print casualty lists where once they printed prizes.',
    'Recruiting officers work the taverns harder than they used to.',
    "Every captain feels the war's weight pressing closer this month.",
  ],
  'war-high': [
    'The beacons are lit along the coast, and no one sleeps easy.',
    'Every covert in the Corps stands to readiness, waiting for the order.',
    "Bonaparte's fleet is sighted, and the whole country holds its breath.",
    'Dispatch riders no longer walk their horses; they run them.',
    'This is no longer a distant war. It is at the door.',
  ],
}

export const MISSION_NAMES: { dispatch: string[]; combat: string[]; formation: string[]; war: string[] } = {
  dispatch: [
    'Dover Dispatch',
    'Channel Packet',
    'Whitehall Express',
    'Coastal Courier Run',
    'Fleet Orders Relay',
    'Portsmouth Post',
  ],
  combat: [
    'Skirmish off the Lizard',
    'Raid on the Coastal Battery',
    'Interception at Dawn',
    'Engagement over the Downs',
    'Sweep of the Approaches',
    'Action off Ushant',
  ],
  formation: [
    'Line Drill over the Solent',
    'Formation Exercise',
    'Escort Rehearsal',
    'Fleet Screen Manoeuvre',
    'Covert Muster Flight',
    'Wing Review',
  ],
  war: [
    'The Channel Crossing',
    'Defence of the Coast',
    'The Southern Front',
    'Relief of the Blockade',
    'The Grand Sortie',
    'Last Stand at the Cliffs',
  ],
}
