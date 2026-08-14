/** Stable display-only Trace aliases. Do not reorder this list. */
export const TRACE_DISPLAY_NAMES = [
  'Ada', 'Alan', 'Sappho', 'Euclid', 'Hypatia', 'LiBai', 'Homer', 'Curie',
  'Darwin', 'Turing', 'Galileo', 'Newton', 'Kepler', 'Faraday', 'Tesla', 'Aristotle',
  'Plato', 'Confucius', 'Laozi', 'Mencius', 'Avicenna', 'Averroes', 'Rumi', 'Bach',
  'Mozart', 'Beethoven', 'Chopin', 'Handel', 'Vivaldi', 'Debussy', 'Tagore', 'Shakespeare',
  'Dante', 'Cervantes', 'Austen', 'Dickens', 'Woolf', 'Poe', 'Borges', 'DaVinci',
  'Raphael', 'Michelangelo', 'Rembrandt', 'Hokusai', 'Kahlo', 'Monet', 'Vermeer', 'Archimedes',
  'Ptolemy', 'Alhazen', 'Fibonacci', 'Pascal', 'Noether', 'Ramanujan', 'Kovalevskaya', 'Franklin',
  'Meitner', 'Herschel', 'Goodall', 'Carson', 'Hopper', 'Mandela', 'Gandhi', 'King',
  'Parks', 'Tubman', 'Douglass', 'Wollstonecraft', 'Pankhurst', 'ZhengHe', 'Magellan', 'Cook',
  'Earhart', 'Cousteau', 'Nansen', 'IbnBattuta', 'Socrates', 'Diogenes', 'Zhuangzi', 'Spinoza',
  'Kant', 'Hegel', 'Kierkegaard', 'Arendt', 'Murasaki', 'DuFu', 'Basho', 'SorJuana',
  'Neruda', 'Akhmatova', 'Hughes', 'Morrison', 'Aryabhata', 'Khwarizmi', 'Khayyam', 'Brahmagupta',
  'Banach', 'Emmy', 'Sophie', 'Bohr', 'Einstein', 'Feynman', 'Dirac', 'Planck',
  'Wu', 'Raman', 'Chandrasekhar', 'Linnaeus', 'Mendel', 'Pasteur', 'Salk', 'Fleming',
  'Hodgkin', 'McClintock', 'Leakey', 'Babbage', 'Lovelace', 'Shannon', 'Knuth', 'Dijkstra',
  'Ritchie', 'BernersLee', 'Minsky', 'Gutenberg', 'CaiLun', 'Brunel', 'Edison', 'Morse',
  'Bell', 'Watt', 'Nightingale', 'Pericles', 'Ashoka', 'Cleopatra', 'Theodora', 'Sejong',
  'Akbar', 'Saladin', 'Eleanor', 'Hatshepsut', 'Boudica', 'Olympe', 'Sojourner', 'Ida',
  'Simone', 'Malala', 'Epicurus', 'Seneca', 'Marcus', 'Locke', 'Rousseau', 'Mill',
  'DuBois', 'LaoShe', 'LuXun', 'Nizami', 'Kalidasa', 'Petrarch', 'Goethe', 'Pushkin',
  'Chekhov', 'ZhangHeng', 'ShenKuo', 'SuSong', 'Jabir', 'Biruni', 'Rhazes', 'Vesalius',
  'Hedy', 'Katherine', 'Annie', 'Maryam', 'Tu', 'Jane', 'Rachel', 'Barbara',
  'Fermi', 'Oppenheimer', 'Pauli', 'Rutherford', 'Lise', 'Vera', 'Jocelyn', 'Subrahmanyan',
  'Anaximander', 'Herodotus', 'Thucydides', 'SimaQian', 'IbnKhaldun', 'Machiavelli', 'Montesquieu', 'Tocqueville',
  'Hildegard', 'Teresa', 'Hafez', 'Whitman', 'Emily', 'Gibran', 'Rilke', 'Cavafy',
  'Matsuo', 'Kenzaburo', 'Chinua', 'Achebe', 'Baldwin', 'Lorca', 'Proust', 'Colette',
  'Bellini', 'Bernini', 'Rodin', 'OKeeffe', 'Basquiat', 'Klimt', 'Matisse', 'Kandinsky',
  'Hannibal', 'Caesar', 'Augustus', 'SunTzu', 'Joan', 'YiSunSin', 'Bolivar', 'Toussaint',
  'Galois', 'Euler', 'Gauss', 'Riemann', 'Hilbert', 'Kolmogorov', 'Bose', 'Sagan',
  'Hubble', 'Copernicus', 'Tycho', 'Leavitt', 'Payne', 'Rubin', 'Seymour', 'Donald',
  'Grace', 'Margaret', 'Ken', 'Dennis', 'Niklaus', 'Hammurabi', 'Solon', 'Justinian',
  'Mansa', 'Nefertiti', 'WuZetian', 'Isabella', 'Nzinga', 'ZhengYiSao', 'Harriet', 'AungSan',
] as const;

function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 0x01000193); }
  return hash >>> 0;
}

export function traceDisplayName(traceId: string): string {
  return TRACE_DISPLAY_NAMES[stableHash(traceId) % TRACE_DISPLAY_NAMES.length]!;
}
