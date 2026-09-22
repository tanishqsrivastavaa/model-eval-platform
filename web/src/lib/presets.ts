/** The 6 prompt presets — exact port of static/app.js:44-51. */

export type Preset = readonly [label: string, prompt: string];

export const PRESETS: readonly Preset[] = [
  [
    'Fibonacci via Python',
    "Use run_python to compute the 35th Fibonacci number, then double-check the answer's last three digits with the calculator. Report the result.",
  ],
  [
    'Parallel math',
    'Compute these three independently with the calculator, calling the tool for all three in parallel if you can: 2**64, 123456*654321, (17**5) % 1000.',
  ],
  [
    'Write → read → analyze',
    'Create people.csv with 12 made-up people (name, age, city). Then read it back and use Python to compute the average age per city. Report the table.',
  ],
  [
    'Web fetch + summarize',
    'Fetch https://example.com and https://httpbin.org/json, then summarize what each contains in two sentences each.',
  ],
  [
    'Write, run, fix',
    'Write a Python script primes.py that prints all primes below 100, run it, and fix it if the output is wrong. Show the final output.',
  ],
  ['No tools needed', 'In three sentences, explain why the sky is blue. Do not use any tools.'],
];
