# -*- coding: utf-8 -*-
"""数学模块动态提示词（Jinja2 模板）。
不依赖本地题型分类/模板库：所有引导与提取逻辑由大模型直接读题生成。
模板变量：question / sentences。
"""

from jinja2 import Template

# ── analyze：关键信息 + 数量关系提取（数学应用题核心分析） ──

ANALYZE_TEMPLATE = Template(
    """以下是数学应用题的句子列表（已按标点切分）。请输出 JSON：
{"marks":[{"is_key":bool,"highlight":"关键信息摘要，非关键句留空"},...],
 "quantities":[{"name":"实体名","value":数字或null,"unit":"单位"}],
 "relations":[{"a":"主体","b":"基准","type":"more/less/times/total","amount":数字}],
 "questions":[{"text":"问题原文","target":"要求解的量","needs":["先要知道的量"],"hint":"求解方向简述"}]}
 规则：
 1) marks 数组顺序与句子一一对应；is_key=该句是否含**解题必需**的数量条件（数字/倍数/比较关系）。
    **只标真正必需的关键句（通常 1~3 句）**：与求解直接相关的条件句才标 true；
    背景描述、场景铺垫、无数字的句子一律 false。
 2) quantities：每个数量主体一个（如小明/苹果/原价）；已知数值用数字，题目所求未知量 value 为 null，unit 无单位留空字符串。
 3) relations：more=a比b多amount；less=a比b少amount；times=a是b的amount倍；total=求和（a 是『一共』或所求总量，parts 列出所有分量名）。
 4) 求『a比b多/少多少』的差值也要提取（amount=0，quantities 补未知差值实体如『贵的金额』）。
 5) questions：题目里的每个问题一条；needs 是回答该问需要先知道的量；hint 是求解方向（不给答案不剧透）。
 【输出精简】highlight≤10字；JSON 无多余空格与换行；非关键句只输出 is_key=false。
 不要解题过程，不要答案。

 句子列表：
{% for i in range(sentences|length) %}{{ i + 1 }}. {{ sentences[i] }}
{% endfor %}"""
)

def render_analyze(question: str, sentences: list[str]) -> str:
    return ANALYZE_TEMPLATE.render(
        question=question,
        sentences=sentences,
    )
