package main

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
)

type Payload struct {
	Attacker map[string]any `json:"attacker"`
	Defender map[string]any `json:"defender"`
	Mode     string         `json:"mode"`
	ValOrMul float64        `json:"valOrMul"`
	IsSpell  bool           `json:"isSpell"`
}

type Result struct {
	Damage int  `json:"damage"`
	IsCrit bool `json:"isCrit"`
}

func num(m map[string]any, key string, def float64) float64 {
	if m == nil {
		return def
	}
	v, ok := m[key]
	if !ok || v == nil {
		return def
	}
	switch x := v.(type) {
	case float64:
		return x
	case float32:
		return float64(x)
	case int:
		return float64(x)
	case int64:
		return float64(x)
	case int32:
		return float64(x)
	default:
		return def
	}
}

func main() {
	raw, err := io.ReadAll(os.Stdin)
	if err != nil || len(raw) == 0 {
		return
	}

	var p Payload
	if err := json.Unmarshal(raw, &p); err != nil {
		return
	}

	atk := num(p.Attacker, "attack", 0)
	if p.IsSpell {
		atk = num(p.Attacker, "spell_attack", atk)
	}
	if atk <= 0 {
		atk = num(p.Attacker, "phys_atk", atk)
	}

	def := num(p.Defender, "defense", 0)
	if p.IsSpell {
		def = num(p.Defender, "spell_def", def)
	}
	if def <= 0 {
		def = num(p.Defender, "phys_def", def)
	}

	mul := p.ValOrMul
	if mul <= 0 {
		mul = 1
	}

	// 轻量占位算法：仅用于 Go 计算通路联调，生产请替换为与 JS 完全一致的公式。
	rawDamage := atk*mul - def*0.35
	if rawDamage < 1 {
		rawDamage = 1
	}

	out := Result{
		Damage: int(math.Floor(rawDamage)),
		IsCrit: false,
	}
	b, _ := json.Marshal(out)
	_, _ = fmt.Fprintln(os.Stdout, string(b))
}
