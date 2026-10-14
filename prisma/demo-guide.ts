/**
 * Demo study guide for the seeded backpropagation lecture, replayed through
 * the real generator (outline → sections → citation validation → anchors).
 * Written by hand so the app can be explored without an AI provider key;
 * the guide records its model as "demo-fixture". Every excerpt below must
 * occur verbatim in the seeded transcript or slides, or the validator drops it.
 */
import { verifyExcerpt } from "../src/lib/citations/verify";
import type { ChatModel, JsonRequest, JsonResponse } from "../src/server/ai";
import { OutlineSchema, SectionOutputSchema } from "../src/server/generation/study-guide/schemas";

type FixtureClaim = { key: string; claimType: "source_grounded" | "inference" | "external"; excerpts: string[] };
type FixtureSection = {
  kind: (typeof OutlineSchema)["_output"]["sections"][number]["kind"];
  level: 1 | 2;
  title: string;
  learningObjective: string;
  content: string;
  claims: FixtureClaim[];
  aiCreatedPractice?: boolean;
  confidence: number;
  warnings?: string[];
};

const SECTIONS: FixtureSection[] = [
  {
    kind: "LEARNING_OBJECTIVES",
    level: 1,
    title: "Learning objectives",
    learningObjective: "",
    confidence: 0.92,
    content: `After this lecture you should be able to:

- [[claim:k1]]Explain backpropagation as the chain rule applied systematically to a computational graph.[[/claim]]
- [[claim:k2]]Derive the gradients of a linear layer $z = Wx + b$ and check their shapes.[[/claim]]
- [[claim:k3]]Explain why reverse mode is efficient for one scalar loss and many parameters.[[/claim]]
- [[claim:k4]]Verify an implementation with a numerical gradient check.[[/claim]]`,
    claims: [
      { key: "k1", claimType: "source_grounded", excerpts: ["backpropagation, which is really just the chain rule applied systematically to a computational graph"] },
      { key: "k2", claimType: "source_grounded", excerpts: ["Let's do a linear layer. z equals W x plus b."] },
      { key: "k3", claimType: "source_grounded", excerpts: ["reverse mode wins when you have one scalar loss and millions of parameters"] },
      { key: "k4", claimType: "source_grounded", excerpts: ["always verify with a numerical gradient check"] },
    ],
  },
  {
    kind: "EQUATIONS",
    level: 1,
    title: "Key equations and symbols",
    learningObjective: "Recognise the core backpropagation identities and their notation.",
    confidence: 0.9,
    content: `| Symbol | Meaning |
|---|---|
| $L$ | the scalar loss, the final node of the graph |
| $\\delta_z$ | upstream gradient of node $z$ |
| $W, b$ | weights and bias of a linear layer |

[[claim:k1]]The upstream gradient of a node is the derivative of the loss with respect to that node:[[/claim]]

$$\\delta_z \\equiv \\frac{\\partial L}{\\partial z}$$

[[claim:k2]]The chain rule on a graph sums over every child of a node:[[/claim]]

$$\\frac{\\partial L}{\\partial x} = \\sum_{z \\in \\text{children}(x)} \\delta_z \\, \\frac{\\partial z}{\\partial x}$$

[[claim:k3]]The numerical gradient check uses a centred difference:[[/claim]]

$$\\frac{L(\\theta + h) - L(\\theta - h)}{2h}$$`,
    claims: [
      { key: "k1", claimType: "source_grounded", excerpts: ["define the upstream gradient delta z as the partial derivative of L with respect to z"] },
      { key: "k2", claimType: "source_grounded", excerpts: ["the gradient at an input x equals the sum over every child z of x"] },
      { key: "k3", claimType: "source_grounded", excerpts: ["Gradient check: (L(θ + h) − L(θ − h)) / 2h"] },
    ],
  },
  {
    kind: "CONCEPTS",
    level: 1,
    title: "Computational graphs and the forward pass",
    learningObjective: "Describe what the forward pass computes and stores.",
    confidence: 0.88,
    content: `[[claim:k1]]A computational graph is a directed acyclic graph in which each node computes a function of its inputs, and the loss is the final node.[[/claim]]

[[claim:k2]]The forward pass evaluates the nodes in topological order and caches the intermediate values,[[/claim]] [[claim:k3]]because the backward pass needs those cached values.[[/claim]]

[[claim:k4]]Caching is the memory cost of backpropagation; gradient checkpointing recomputes some activations instead of storing them.[[/claim]]`,
    claims: [
      { key: "k1", claimType: "source_grounded", excerpts: ["A computational graph is a directed acyclic graph where each node computes a function of its inputs. The loss is the final node."] },
      { key: "k2", claimType: "source_grounded", excerpts: ["The forward pass evaluates nodes in topological order and caches the intermediate values."] },
      { key: "k3", claimType: "source_grounded", excerpts: ["We will need those cached values on the way back."] },
      { key: "k4", claimType: "source_grounded", excerpts: ["Memory is the trade-off. We store activations from the forward pass. Gradient checkpointing recomputes some of them to save memory."] },
    ],
  },
  {
    kind: "CONCEPTS",
    level: 1,
    title: "The chain rule on a graph",
    learningObjective: "Apply the chain rule node by node, including fan-out.",
    confidence: 0.9,
    content: `[[claim:k1]]For every node $z$ we track its upstream gradient $\\delta_z$.[[/claim]] [[claim:k2]]The gradient at an input $x$ is the sum, over every child $z$ of $x$, of $\\delta_z$ times the local derivative of $z$ with respect to $x$.[[/claim]]

[[claim:k3]]The sum matters: when $x$ fans out to several children, the gradients from each branch add.[[/claim]] [[claim:k4]]Forgetting this is the most common bug in hand-written backpropagation.[[/claim]]

[[claim:k5]]Because each node only needs its own local derivative and the upstream gradients of its children, the whole computation can be organised as one sweep in reverse topological order.[[/claim]]`,
    claims: [
      { key: "k1", claimType: "source_grounded", excerpts: ["For any node z, define the upstream gradient delta z"] },
      { key: "k2", claimType: "source_grounded", excerpts: ["the gradient at an input x equals the sum over every child z of x, of delta z times the local derivative of z with respect to x"] },
      { key: "k3", claimType: "source_grounded", excerpts: ["If x fans out to several children, gradients from each branch add.", "Gradients from multiple children are summed."] },
      { key: "k4", claimType: "source_grounded", excerpts: ["Forgetting this is the most common bug in hand-written backprop."] },
      // A synthesis the lecture implies but does not state outright.
      { key: "k5", claimType: "inference", excerpts: ["The forward pass evaluates nodes in topological order"] },
    ],
  },
  {
    kind: "DERIVATION",
    level: 2,
    title: "Gradients of a linear layer",
    learningObjective: "Derive the gradients with respect to W, b and x.",
    confidence: 0.91,
    content: `[[claim:k1]]For a linear layer $z = Wx + b$, the upstream gradient $\\delta_z$ is a vector with the same shape as $z$.[[/claim]]

[[claim:k2]]The weight gradient is an outer product, and the bias gradient is the upstream gradient itself:[[/claim]]

$$\\frac{\\partial L}{\\partial W} = \\delta_z x^\\top, \\qquad \\frac{\\partial L}{\\partial b} = \\delta_z$$

[[claim:k3]]The gradient passed further back to the input is[[/claim]]

$$\\frac{\\partial L}{\\partial x} = W^\\top \\delta_z$$

\`\`\`python
def linear_backward(dz, x, W):
    return dz @ x.T, dz, W.T @ dz  # dW, db, dx
\`\`\`

[[claim:k4]]Check the shapes every time — it is the best debugging tool.[[/claim]] [[claim:k5]]For an elementwise nonlinearity such as ReLU, the local derivative is 1 where the input was positive and 0 elsewhere, so the backward pass simply masks $\\delta$.[[/claim]]`,
    claims: [
      { key: "k1", claimType: "source_grounded", excerpts: ["The upstream gradient delta z is a vector the same shape as z."] },
      { key: "k2", claimType: "source_grounded", excerpts: ["the gradient with respect to W is delta z times x transpose, an outer product", "∂L/∂W = δ_z xᵀ"] },
      { key: "k3", claimType: "source_grounded", excerpts: ["the gradient passed further back, to x, is W transpose times delta z"] },
      { key: "k4", claimType: "source_grounded", excerpts: ["Check the shapes every time: that is your best debugging tool."] },
      { key: "k5", claimType: "source_grounded", excerpts: ["the local derivative is one where the input was positive and zero elsewhere, so we just mask delta"] },
    ],
  },
  {
    kind: "WORKED_EXAMPLE",
    level: 2,
    title: "Practice: a two-branch graph",
    learningObjective: "Apply the fan-out rule to a small example.",
    aiCreatedPractice: true,
    confidence: 0.8,
    content: `Let $a = 2x$ and $c = x^2$, and let the loss be $L = a + c$. Then $x$ fans out to two children.

1. Upstream gradients: $\\delta_a = 1$ and $\\delta_c = 1$.
2. Local derivatives: $\\partial a / \\partial x = 2$ and $\\partial c / \\partial x = 2x$.
3. Sum over children: $\\partial L / \\partial x = 1 \\cdot 2 + 1 \\cdot 2x = 2 + 2x$.

At $x = 3$ the gradient is $8$. Dropping either branch would give a wrong answer.`,
    claims: [],
  },
  {
    kind: "CONCEPTS",
    level: 1,
    title: "Why reverse mode is efficient",
    learningObjective: "Compare forward-mode and reverse-mode cost.",
    confidence: 0.87,
    content: `- [[claim:k1]]The backward pass costs roughly the same order as the forward pass — about two to three times.[[/claim]]
- [[claim:k2]]Forward-mode differentiation needs one pass per input dimension; reverse mode needs one pass per output.[[/claim]]
- [[claim:k3]]With a single scalar loss and millions of parameters, reverse mode therefore wins.[[/claim]]`,
    claims: [
      { key: "k1", claimType: "source_grounded", excerpts: ["the backward pass costs roughly the same order as the forward pass, about two to three times"] },
      { key: "k2", claimType: "source_grounded", excerpts: ["Forward-mode differentiation would need one pass per input dimension. Reverse mode needs one pass per output"] },
      { key: "k3", claimType: "source_grounded", excerpts: ["reverse mode wins when you have one scalar loss and millions of parameters"] },
    ],
  },
  {
    kind: "MISCONCEPTIONS",
    level: 1,
    title: "Common mistakes",
    learningObjective: "Avoid the typical bugs in hand-written backprop.",
    confidence: 0.85,
    content: `- [[claim:k1]]**Overwriting instead of accumulating** gradients at a node with several children — the branches must be summed.[[/claim]]
- [[claim:k2]]**Shape mismatches**, e.g. using $W$ instead of $W^\\top$ when passing the gradient back to $x$.[[/claim]]
- [[claim:k3]]**Trusting an implementation without a numerical gradient check.**[[/claim]]`,
    claims: [
      { key: "k1", claimType: "source_grounded", excerpts: ["If x fans out to several children, gradients from each branch add."] },
      { key: "k2", claimType: "source_grounded", excerpts: ["is W transpose times delta z. Check the shapes every time"] },
      { key: "k3", claimType: "source_grounded", excerpts: ["always verify with a numerical gradient check"] },
    ],
  },
  {
    kind: "RECALL_PROMPTS",
    level: 1,
    title: "Recall prompts",
    learningObjective: "Retrieve the key ideas without notes.",
    confidence: 0.9,
    content: `1. [[claim:k1]]What is $\\delta_z$, and how is it defined?[[/claim]]
2. [[claim:k2]]What must you do when a node fans out to several children?[[/claim]]
3. [[claim:k3]]Write the three gradients of a linear layer.[[/claim]]
4. [[claim:k4]]Why does reverse mode beat forward mode for training neural networks?[[/claim]]
5. [[claim:k5]]What formula does a numerical gradient check compare against?[[/claim]]`,
    claims: [
      { key: "k1", claimType: "source_grounded", excerpts: ["define the upstream gradient delta z as the partial derivative of L with respect to z"] },
      { key: "k2", claimType: "source_grounded", excerpts: ["gradients from each branch add"] },
      { key: "k3", claimType: "source_grounded", excerpts: ["∂L/∂W = δ_z xᵀ    ∂L/∂b = δ_z    ∂L/∂x = Wᵀ δ_z"] },
      { key: "k4", claimType: "source_grounded", excerpts: ["Reverse mode needs one pass per output, and we have one output, the loss."] },
      { key: "k5", claimType: "source_grounded", excerpts: ["compare against the centered difference L of theta plus h minus L of theta minus h, over two h"] },
    ],
  },
];

/** Replays the fixture: resolves each excerpt to whichever offered passage contains it. */
export class DemoFixtureModel implements ChatModel {
  readonly provider = "fixture";
  readonly model = "demo-fixture";

  async generateJson<T>(req: JsonRequest<T>): Promise<JsonResponse<T>> {
    const passages = [...req.prompt.matchAll(/<passage ref="(C\d+)"[^>]*>\n([\s\S]*?)\n<\/passage>/g)].map((m) => ({ ref: m[1]!, text: m[2]! }));
    const usage = { inputTokens: 0, outputTokens: 0 };

    if (!req.prompt.includes("Write only this section")) {
      const outline = {
        title: "Backpropagation and Computational Graphs",
        sections: SECTIONS.map((s, i) => ({
          key: `s${i + 1}`,
          level: s.level,
          kind: s.kind,
          title: s.title,
          learningObjective: s.learningObjective,
          sourceRefs: passages.map((p) => p.ref),
        })),
      };
      return { data: req.schema.parse(OutlineSchema.parse(outline)), usage, model: this.model };
    }

    const title = /\nSection: (.+)\n/.exec(req.prompt)?.[1];
    const section = SECTIONS.find((s) => s.title === title);
    if (!section) throw new Error(`No fixture for section "${title}"`);
    const output = {
      content: section.content,
      claims: section.claims.map((c) => ({
        key: c.key,
        claimType: c.claimType,
        citations: c.excerpts.flatMap((excerpt) => {
          const hit = passages.find((p) => verifyExcerpt(excerpt, p.text));
          return hit ? [{ ref: hit.ref, excerpt }] : [];
        }),
      })),
      aiCreatedPractice: section.aiCreatedPractice ?? false,
      confidence: section.confidence,
      warnings: section.warnings ?? [],
    };
    return { data: req.schema.parse(SectionOutputSchema.parse(output)), usage, model: this.model };
  }
}
