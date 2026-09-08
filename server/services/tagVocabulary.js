/**
 * The controlled vocabulary the auto-tagger may choose from.
 *
 * Tags are a closed set on purpose. Free-form tagging produces "python",
 * "Python", "python3" and "python-programming" for the same subject, which
 * makes the tag filter useless — the thing tags exist for here. A fixed list
 * keeps every tag worth filtering by.
 *
 * Each entry carries a short gloss shown to the model. That is what stops
 * "networking" being applied to a book about making business contacts: the
 * gloss says which sense is meant.
 */

const VOCABULARY = [
  // Languages
  { tag: 'python', hint: 'the Python language, Django, Flask, pandas, NumPy' },
  { tag: 'javascript', hint: 'JavaScript, Node.js, npm' },
  { tag: 'typescript', hint: 'TypeScript' },
  { tag: 'java', hint: 'the Java language, Spring, JVM' },
  { tag: 'kotlin', hint: 'Kotlin' },
  { tag: 'swift', hint: 'Swift' },
  { tag: 'go', hint: 'the Go language (Golang)' },
  { tag: 'rust', hint: 'the Rust language' },
  { tag: 'c', hint: 'the C language' },
  { tag: 'cpp', hint: 'C++' },
  { tag: 'csharp', hint: 'C# and .NET' },
  { tag: 'php', hint: 'PHP, Laravel' },
  { tag: 'ruby', hint: 'Ruby, Rails' },
  { tag: 'r', hint: 'the R language for statistics' },
  { tag: 'sql', hint: 'the SQL language and query writing' },
  { tag: 'bash', hint: 'shell scripting, bash, zsh, command line' },

  // Web
  { tag: 'web', hint: 'web development generally, HTTP, browsers' },
  { tag: 'frontend', hint: 'client-side UI development, HTML, CSS' },
  { tag: 'react', hint: 'React, React Native, Next.js' },
  { tag: 'angular', hint: 'Angular' },
  { tag: 'vue', hint: 'Vue.js' },
  { tag: 'backend', hint: 'server-side development' },
  { tag: 'api', hint: 'designing or consuming APIs, REST, GraphQL' },

  // Data
  { tag: 'databases', hint: 'database systems, PostgreSQL, MySQL, MongoDB, Redis' },
  { tag: 'data-engineering', hint: 'pipelines, ETL, warehousing, Spark, Airflow' },
  { tag: 'data-science', hint: 'analysing data to draw conclusions' },
  { tag: 'analytics', hint: 'business intelligence, dashboards, reporting' },
  { tag: 'statistics', hint: 'statistical methods, probability, inference' },
  { tag: 'machine-learning', hint: 'training predictive models, scikit-learn' },
  { tag: 'deep-learning', hint: 'neural networks, PyTorch, TensorFlow' },
  { tag: 'llm', hint: 'large language models, prompting, generative AI, agents' },
  { tag: 'nlp', hint: 'natural language processing by computer — NOT neuro-linguistic programming or communication skills' },
  { tag: 'computer-vision', hint: 'image recognition and processing' },

  // Infrastructure
  { tag: 'devops', hint: 'CI/CD, automation, SRE, deployment practice' },
  { tag: 'docker', hint: 'containers, Docker' },
  { tag: 'kubernetes', hint: 'Kubernetes, container orchestration' },
  { tag: 'cloud', hint: 'cloud platforms generally' },
  { tag: 'aws', hint: 'Amazon Web Services' },
  { tag: 'azure', hint: 'Microsoft Azure' },
  { tag: 'linux', hint: 'Linux and Unix system administration' },
  { tag: 'networking', hint: 'COMPUTER networks, TCP/IP, routing — never social or business contacts' },
  { tag: 'distributed-systems', hint: 'systems spanning many machines, consistency, replication' },
  { tag: 'microservices', hint: 'microservice architecture' },
  { tag: 'architecture', hint: 'software architecture and system design' },
  { tag: 'performance', hint: 'optimisation, profiling, scalability' },

  // Practice
  { tag: 'algorithms', hint: 'algorithms and data structures' },
  { tag: 'testing', hint: 'automated testing, TDD, QA' },
  { tag: 'git', hint: 'version control, Git' },
  { tag: 'agile', hint: 'agile, scrum, software project management' },
  { tag: 'clean-code', hint: 'refactoring, code quality, design patterns' },
  { tag: 'security', hint: 'information security, hacking, cryptography, privacy' },

  // Hardware
  { tag: 'embedded', hint: 'microcontrollers and embedded programming' },
  { tag: 'arduino', hint: 'Arduino projects' },
  { tag: 'raspberry-pi', hint: 'Raspberry Pi projects' },
  { tag: 'iot', hint: 'internet of things, connected devices' },
  { tag: 'robotics', hint: 'robots and automation hardware' },
  { tag: 'electronics', hint: 'circuits, soldering, hardware making' },

  // Applications
  { tag: 'mobile', hint: 'mobile app development, iOS, Android, Flutter' },
  { tag: 'game-development', hint: 'making games, Unity, Godot' },
  { tag: 'blockchain', hint: 'blockchain, cryptocurrency, smart contracts' },

  // Design and tools
  { tag: 'design', hint: 'visual and graphic design' },
  { tag: 'ux', hint: 'user experience, usability, interaction design' },
  { tag: 'excel', hint: 'spreadsheets, Excel, Power Query' },
  { tag: 'power-bi', hint: 'Power BI, Tableau, BI tooling' },

  // Business and life
  { tag: 'business', hint: 'running a business, strategy, entrepreneurship' },
  { tag: 'management', hint: 'leading teams and people' },
  { tag: 'marketing', hint: 'marketing, sales, growth' },
  { tag: 'finance', hint: 'money, accounting, investing, trading' },
  { tag: 'career', hint: 'jobs, interviewing, professional networking, personal growth at work' },
  { tag: 'productivity', hint: 'habits, time management, getting things done' },
  { tag: 'self-help', hint: 'personal development, motivation, communication and social skills' },
  { tag: 'psychology', hint: 'the mind, behaviour, cognition' },
  { tag: 'philosophy', hint: 'philosophy and ethics' },
  { tag: 'history', hint: 'historical subjects' },
  { tag: 'science', hint: 'natural sciences, physics, chemistry, biology' },
  { tag: 'mathematics', hint: 'mathematics beyond statistics' },
  { tag: 'health', hint: 'medicine, fitness, nutrition, wellbeing' },
  { tag: 'cooking', hint: 'recipes, food, cookery' },
  { tag: 'writing', hint: 'writing craft, language, communication' },
  { tag: 'education', hint: 'teaching and learning' },
  { tag: 'art', hint: 'art, music, photography, creative work' },
  { tag: 'fiction', hint: 'novels and short stories' },
  { tag: 'reference', hint: 'dictionaries, encyclopedias, pure reference works' }
];

const TAGS = VOCABULARY.map((entry) => entry.tag);
const TAG_SET = new Set(TAGS);

/**
 * Common ways a model or a person writes a tag that means one of ours.
 * Applied before the membership check so near-misses are kept rather than
 * thrown away.
 */
const ALIASES = new Map([
  ['c++', 'cpp'], ['c#', 'csharp'], ['.net', 'csharp'], ['dotnet', 'csharp'],
  ['golang', 'go'], ['node', 'javascript'], ['nodejs', 'javascript'],
  ['js', 'javascript'], ['ts', 'typescript'], ['py', 'python'],
  ['ml', 'machine-learning'], ['ai', 'llm'], ['artificial-intelligence', 'llm'],
  ['genai', 'llm'], ['generative-ai', 'llm'], ['neural-networks', 'deep-learning'],
  ['database', 'databases'], ['db', 'databases'], ['postgresql', 'databases'],
  ['postgres', 'databases'], ['mysql', 'databases'], ['mongodb', 'databases'],
  ['k8s', 'kubernetes'], ['containers', 'docker'], ['ci-cd', 'devops'], ['sre', 'devops'],
  ['programming', null], ['software', null], ['technology', null], ['computers', null],
  ['tutorial', null], ['guide', null], ['book', null], ['general', null],
  ['data', 'data-science'], ['datascience', 'data-science'],
  ['ui', 'ux'], ['user-interface', 'ux'], ['user-experience', 'ux'],
  ['leadership', 'management'], ['money', 'finance'], ['investing', 'finance'],
  ['trading', 'finance'], ['startup', 'business'], ['startups', 'business'],
  ['entrepreneurship', 'business'], ['networking-business', 'career'],
  ['fitness', 'health'], ['nutrition', 'health'], ['medicine', 'health'],
  ['diet', 'health'], ['recipes', 'cooking'], ['food', 'cooking'],
  ['maths', 'mathematics'], ['math', 'mathematics'],
  ['physics', 'science'], ['chemistry', 'science'], ['biology', 'science'],
  ['novel', 'fiction'], ['literature', 'fiction'],
  ['ios', 'mobile'], ['android', 'mobile'], ['flutter', 'mobile'],
  ['shell', 'bash'], ['command-line', 'bash'], ['terminal', 'bash'],
  ['unix', 'linux'], ['system-administration', 'linux'],
  ['design-patterns', 'clean-code'], ['refactoring', 'clean-code'],
  ['cryptography', 'security'], ['hacking', 'security'], ['privacy', 'security'],
  ['scrum', 'agile'], ['project-management', 'agile'],
  // Phrasings the model actually produced over a 40-book sample. Mapping them
  // is cheaper than tightening the prompt further, and loses nothing.
  ['software-architecture', 'architecture'], ['system-design', 'architecture'],
  ['soldering', 'electronics'], ['hardware', 'electronics'],
  ['parallel-computing', 'performance'], ['concurrency', 'performance'],
  ['supercomputers', 'distributed-systems'], ['high-performance-computing', 'performance'],
  ['computer-algebra', 'mathematics'], ['shell-scripting', 'bash'],
  ['patterns', 'clean-code'], ['software-engineering', 'clean-code'],
  ['web-development', 'web'], ['web-design', 'web'],
  ['machine-learning-engineering', 'machine-learning'],
  ['artificial-intelligence-ai', 'llm'], ['chatgpt', 'llm'], ['prompt-engineering', 'llm'],
  ['data-analysis', 'data-science'], ['data-visualization', 'analytics'],
  ['cyber-security', 'security'], ['cybersecurity', 'security'],
  ['operating-systems', 'linux'], ['computer-science', 'algorithms'],
  ['personal-finance', 'finance'], ['communication', 'self-help'],
  ['photography', 'art'], ['music', 'art'], ['nutrition-and-diet', 'health']
]);

/**
 * Fold one proposed tag to a vocabulary member, or null if it is not one.
 * Models invent tags however firmly the prompt forbids it — a benchmark run
 * returned "programming", which is in no list given to it — so membership is
 * enforced here rather than trusted from the reply.
 */
function canonicalize(raw) {
  if (!raw || typeof raw !== 'string') return null;

  // The vocabulary is shown to the model as "tag — what it means", and the
  // model sometimes echoes the whole line back rather than just the name.
  // Keep the part before the separator instead of rejecting the tag.
  const name = String(raw).split(/\s+[—–-]\s+|:\s+/)[0];

  const key = name
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9+#-]/g, '')
    .replace(/^-+|-+$/g, '');

  if (!key) return null;
  if (TAG_SET.has(key)) return key;

  if (ALIASES.has(key)) return ALIASES.get(key);          // may be null: drop it

  const singular = key.replace(/s$/, '');
  if (TAG_SET.has(singular)) return singular;
  if (ALIASES.has(singular)) return ALIASES.get(singular);

  // Version suffixes: "python3", "vue2", "angular-14" all mean the base tag.
  const unversioned = key.replace(/-?\d+(\.\d+)*$/, '');
  if (unversioned !== key) {
    if (TAG_SET.has(unversioned)) return unversioned;
    if (ALIASES.has(unversioned)) return ALIASES.get(unversioned);
  }

  return null;
}

/** The vocabulary as prompt lines: "tag — what it means". */
function asPromptList() {
  return VOCABULARY.map(({ tag, hint }) => `${tag} — ${hint}`).join('\n');
}

module.exports = { VOCABULARY, TAGS, TAG_SET, canonicalize, asPromptList };
