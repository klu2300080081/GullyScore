"""
==============================================================================
GULLY CRICKET SCORING SYSTEM
==============================================================================
A complete terminal-based Gully Cricket scoring system using OOP in Python.
Supports configurable match settings, ball-by-ball scoring, scorecards,
undo, extras, byes, run-outs, retired players, and full match summary.

Usage:
    python gully_cricket.py
    (or paste into Google Colab)
==============================================================================
"""

from __future__ import annotations
import copy
from dataclasses import dataclass, field
from typing import Optional
from enum import Enum


# ==============================================================================
# ENUMS & CONSTANTS
# ==============================================================================

class Outcome(Enum):
    """Possible outcomes for a ball event."""
    DOT        = "0"
    ONE        = "1"
    TWO        = "2"
    THREE      = "3"
    FOUR       = "4"
    SIX        = "6"
    NB         = "NB"
    NB1        = "NB+1"
    NB2        = "NB+2"
    NB3        = "NB+3"
    NB4        = "NB+4"
    NB6        = "NB+6"
    WD         = "WD"
    WD1        = "WD+1"
    WD2        = "WD+2"
    WD3        = "WD+3"
    WD4        = "WD+4"
    BYE1       = "BYE+1"
    BYE2       = "BYE+2"
    BYE3       = "BYE+3"
    BYE4       = "BYE+4"
    LB1        = "LB+1"
    LB2        = "LB+2"
    LB3        = "LB+3"
    LB4        = "LB+4"
    WICKET     = "W"
    RO_S0      = "RO-S+0"
    RO_S1      = "RO-S+1"
    RO_S2      = "RO-S+2"
    RO_S3      = "RO-S+3"
    RO_S4      = "RO-S+4"
    RO_NS0     = "RO-NS+0"
    RO_NS1     = "RO-NS+1"
    RO_NS2     = "RO-NS+2"
    RO_NS3     = "RO-NS+3"
    RO_NS4     = "RO-NS+4"
    RETIRED    = "RETIRED"
    ROTATE     = "ROTATE"
    DB         = "DB"
    UNDO       = "UNDO"


# Map outcome string -> (team_runs, batsman_runs, is_legal, is_wicket, rotates_strike)
# Filled dynamically in helper functions below.

VALID_COMMANDS = {o.value for o in Outcome}

LINE = "=" * 64
THIN = "-" * 64


# ==============================================================================
# PLAYER
# ==============================================================================

@dataclass
class Player:
    """
    Represents a cricket player.
    A player may belong to multiple teams.
    Identity-only: no stats stored here (stats live in scorecards).
    """
    name: str

    def __repr__(self) -> str:
        return f"Player({self.name!r})"

    def __hash__(self) -> int:
        return hash(self.name)

    def __eq__(self, other: object) -> bool:
        return isinstance(other, Player) and self.name == other.name


# ==============================================================================
# TEAM
# ==============================================================================

class Team:
    """
    Represents a cricket team.
    Supports add/remove/transfer of players.
    """

    def __init__(self, name: str):
        self.name: str = name
        self.players: list[Player] = []

    def add_player(self, player: Player) -> None:
        """Add a player to the team (duplicates not allowed)."""
        if player in self.players:
            print(f"[WARN] {player.name} is already in {self.name}.")
            return
        self.players.append(player)
        print(f"  ✓ {player.name} added to {self.name}.")

    def remove_player(self, player: Player) -> None:
        """Remove a player from the team."""
        if player not in self.players:
            print(f"[WARN] {player.name} is not in {self.name}.")
            return
        self.players.remove(player)
        print(f"  ✓ {player.name} removed from {self.name}.")

    def transfer_player(self, player: Player, target_team: "Team") -> None:
        """Transfer a player from this team to another team."""
        if player not in self.players:
            print(f"[WARN] {player.name} is not in {self.name}.")
            return
        self.remove_player(player)
        target_team.add_player(player)
        print(f"  ✓ {player.name} transferred from {self.name} to {target_team.name}.")

    def display(self) -> None:
        """Print team roster."""
        print(f"\n{self.name} [{len(self.players)} players]")
        for i, p in enumerate(self.players, 1):
            print(f"  {i}. {p.name}")

    def __repr__(self) -> str:
        return f"Team({self.name!r}, players={[p.name for p in self.players]})"


# ==============================================================================
# MATCH SETTINGS
# ==============================================================================

@dataclass
class MatchSettings:
    """
    All configurable settings for a match.
    Collected from the user before the match starts.
    """
    overs: int = 6
    extras_enabled: bool = False
    byes_enabled: bool = False
    single_batting_mode: bool = False
    baby_overs_allowed: bool = False
    bowler_over_limit: int = 2
    consecutive_overs_allowed: bool = False


# ==============================================================================
# BATTING SCORECARD (per player per innings)
# ==============================================================================

@dataclass
class BatsmanRecord:
    """Batting record for one batsman in one innings."""
    player: Player
    runs: int = 0
    balls: int = 0
    fours: int = 0
    sixes: int = 0
    status: str = "yet to bat"  # "yet to bat" | "batting" | "out" | "retired" | "not out"

    @property
    def strike_rate(self) -> float:
        return round((self.runs / self.balls * 100), 2) if self.balls > 0 else 0.0

    def display_row(self) -> str:
        sr = f"{self.strike_rate:.2f}" if self.balls > 0 else "-"
        return (
            f"  {self.player.name:<18} {self.status:<12} "
            f"{self.runs:>4}  {self.balls:>4}  {self.fours:>4}  {self.sixes:>4}  {sr:>7}"
        )


# ==============================================================================
# BOWLING SCORECARD (per bowler per innings)
# ==============================================================================

@dataclass
class BowlerRecord:
    """Bowling record for one bowler in one innings."""
    player: Player
    legal_balls: int = 0
    runs_conceded: int = 0
    wickets: int = 0
    extras: int = 0     # NB + WD runs attributed to bowler

    @property
    def overs_str(self) -> str:
        full_overs = self.legal_balls // 6
        rem = self.legal_balls % 6
        return f"{full_overs}.{rem}"

    @property
    def economy(self) -> float:
        overs = self.legal_balls / 6
        return round(self.runs_conceded / overs, 2) if overs > 0 else 0.0

    def display_row(self) -> str:
        eco = f"{self.economy:.2f}" if self.legal_balls > 0 else "-"
        return (
            f"  {self.player.name:<18} {self.overs_str:>6}  "
            f"{self.runs_conceded:>5}  {self.wickets:>4}  {self.extras:>6}  {eco:>7}"
        )


# ==============================================================================
# BALL (single delivery record)
# ==============================================================================

@dataclass
class BallRecord:
    """
    Immutable record of a single ball event.
    Stored in ball log.
    """
    innings_num: int
    over_num: int
    ball_num: int               # legal ball number within over (0 = not a legal ball)
    batsman: str
    bowler: str
    event: str
    runs: int
    legal_ball: bool
    description: str = ""

    def display(self) -> str:
        legal_marker = "●" if self.legal_ball else "○"
        return (
            f"  I{self.innings_num} | Ov {self.over_num}.{self.ball_num} {legal_marker} | "
            f"{self.batsman:<14} | {self.bowler:<14} | {self.event:<12} | {self.runs:>2} runs"
        )


# ==============================================================================
# OVER
# ==============================================================================

class Over:
    """
    Represents one INNINGS over boundary unit (always 6 legal balls wide).

    KEY DESIGN — two independent counters:

    innings_legal_balls_in_over
        Counts legal balls that fall within this innings-over slot (0–6).
        When this reaches 6 the innings-over boundary fires:
          • strike rotates
          • display "OVER COMPLETED"
          • a new innings-over number begins
        This is SEPARATE from the bowler's selected over.

    bowler_balls_remaining
        Counts how many legal deliveries the *selected* bowler still owes.
        Set at over-type selection time (3 for Baby, 6 for Normal).
        Decremented on every legal ball regardless of innings-over boundary.
        When it reaches 0 the bowler's spell ends and a new bowler is chosen.

    A Normal Over may therefore span TWO innings-over boundaries.
    Example: innings at 0.3 → bowler selects Normal Over (6 balls).
        Ball 1,2,3 → innings reaches 1.0 → OVER COMPLETED, strike rotates.
        Ball 4,5,6 → innings reaches 1.3 → bowler's 6th delivery → spell ends.
    """

    def __init__(
        self,
        innings_over_num: int,   # which innings-over slot this is (1-based)
        bowler: Player,
        is_baby: bool = False,
    ):
        self.innings_over_num: int = innings_over_num
        self.bowler: Player = bowler
        self.is_baby: bool = is_baby

        # Bowler's selected delivery quota (independent of innings over boundary)
        self.bowler_balls_required: int = 3 if is_baby else 6
        self.bowler_balls_remaining: int = self.bowler_balls_required

        # Innings-over slot tracking (always 6-ball boundary)
        self.innings_legal_balls_in_over: int = 0   # balls in current 6-ball slot
        self.total_balls: int = 0                   # all deliveries including extras
        self.runs: int = 0
        self.wickets: int = 0

    # ---- Bowler spell complete? ----
    def is_bowler_spell_complete(self) -> bool:
        """True when this bowler has bowled all selected deliveries."""
        return self.bowler_balls_remaining <= 0

    # ---- Innings-over boundary crossed? ----
    def innings_over_boundary_just_crossed(self) -> bool:
        """
        True when exactly 6 legal balls have fallen in the current
        innings-over slot (i.e. the over-number just ticked up).
        """
        return self.innings_legal_balls_in_over == 6

    def over_type_str(self) -> str:
        return "Baby Over (3 balls)" if self.is_baby else "Normal Over (6 balls)"

    def __repr__(self) -> str:
        return (
            f"Over(innings_ov={self.innings_over_num}, bowler={self.bowler.name}, "
            f"bowler_remaining={self.bowler_balls_remaining}/{self.bowler_balls_required}, "
            f"innings_balls_in_ov={self.innings_legal_balls_in_over})"
        )


# ==============================================================================
# INNINGS STATE
# ==============================================================================

class InningsState:
    """
    Full mutable state of an innings.
    Used for UNDO snapshots (deep-copied).

    Two independent counters (per spec):
        legal_balls_total           — drives innings overs display & innings completion
        bowler_legal_balls_bowled   — drives per-bowler over-limit enforcement (in balls)
    """

    def __init__(
        self,
        innings_num: int,
        batting_team: Team,
        bowling_team: Team,
        settings: MatchSettings,
        target: Optional[int] = None,
    ):
        self.innings_num: int = innings_num
        self.batting_team: Team = batting_team
        self.bowling_team: Team = bowling_team
        self.settings: MatchSettings = settings
        self.target: Optional[int] = target

        # ---- Score ----
        self.total_runs: int = 0
        self.wickets: int = 0
        self.extras: int = 0

        # ---- COUNTER 1: innings legal balls (drives overs display & completion) ----
        self.legal_balls_total: int = 0

        # ---- Over objects (one per innings-over slot) ----
        # current_over tracks the active Over object.
        # When a bowler's spell spans an innings-over boundary, we create a new
        # Over slot object but continue decrementing the same bowler's remaining balls.
        self.completed_overs: list[Over] = []   # fully completed innings-over slots
        self.current_over: Optional[Over] = None

        # ---- Batsmen ----
        self.batsmen_records: dict[str, BatsmanRecord] = {}
        for p in batting_team.players:
            self.batsmen_records[p.name] = BatsmanRecord(player=p)

        self.striker: Optional[Player] = None
        self.non_striker: Optional[Player] = None
        self.retired_players: list[Player] = []
        self.dismissed_players: list[Player] = []

        # ---- Bowlers ----
        self.bowler_records: dict[str, BowlerRecord] = {}
        for p in bowling_team.players:
            self.bowler_records[p.name] = BowlerRecord(player=p)

        self.current_bowler: Optional[Player] = None

        # COUNTER 2: per-bowler legal balls bowled total (used for limit enforcement)
        # Limit is: bowler_over_limit * 6 legal balls maximum
        self.bowler_legal_balls_bowled: dict[str, int] = {
            p.name: 0 for p in bowling_team.players
        }

        # Last bowler (for consecutive-over rule)
        self.last_bowler: Optional[Player] = None

        # Current bowler's remaining balls in their selected spell
        # (kept here so UNDO snapshots capture it correctly)
        self.current_bowler_balls_remaining: int = 0

        # ---- Ball log ----
        self.ball_log: list[BallRecord] = []

        # ---- Innings active ----
        self.active: bool = True

    # ------------------------------------------------------------------
    # HELPERS
    # ------------------------------------------------------------------

    def available_batsmen(self) -> list[Player]:
        """Return players who can bat (not dismissed, not currently batting)."""
        result = []
        for p in self.batting_team.players:
            rec = self.batsmen_records[p.name]
            if (
                rec.status in ("yet to bat", "retired")
                and p is not self.striker
                and p is not self.non_striker
            ):
                result.append(p)
        return result

    def innings_total_balls_limit(self) -> int:
        """Total legal balls allowed in this innings (overs × 6)."""
        return self.settings.overs * 6

    def innings_balls_remaining(self) -> int:
        """How many legal balls remain before innings overs are exhausted."""
        return self.innings_total_balls_limit() - self.legal_balls_total

    def bowler_balls_limit(self) -> int:
        """Maximum legal balls any bowler may bowl."""
        return self.settings.bowler_over_limit * 6

    def current_innings_over_num(self) -> int:
        """1-based innings-over number (based on legal_balls_total)."""
        return (self.legal_balls_total // 6) + 1

    def overs_str(self) -> str:
        """Display string for innings overs progress (e.g. 1.3)."""
        full = self.legal_balls_total // 6
        rem = self.legal_balls_total % 6
        return f"{full}.{rem}"

    def score_str(self) -> str:
        return f"{self.total_runs}/{self.wickets}"

    def all_out(self) -> bool:
        """True if the batting side is all out."""
        if self.settings.single_batting_mode:
            return self.striker is None and not self.available_batsmen()
        else:
            batters_available = len(self.available_batsmen())
            batters_in = sum(
                1 for p in [self.striker, self.non_striker] if p is not None
            )
            return (batters_in + batters_available) < 1 or self.wickets >= len(
                self.batting_team.players
            ) - 1

    def target_chased(self) -> bool:
        return self.target is not None and self.total_runs >= self.target


# ==============================================================================
# INNINGS ENGINE
# ==============================================================================

class Innings:
    """
    Drives ball-by-ball scoring for a single innings.

    Over rules implemented (per spec):
    ─────────────────────────────────────────────────────────────────────────
    RULE 1 – Normal Over may span innings-over boundaries.
        The bowler's selected delivery quota (3 or 6) is tracked independently
        of the 6-ball innings-over boundary.  When the innings-over boundary
        fires mid-spell the system displays "OVER COMPLETED", rotates strike,
        and continues without prompting for a new bowler.

    RULE 2 – Over-type availability is constrained by remaining innings balls.
        If < 6 innings balls remain only Baby Over is offered.
        If >= 6 innings balls remain both options are available.

    RULE 3 – Bowler limit is enforced in legal balls (limit × 6).
        Before a bowler is allowed to start a spell the system checks:
        balls_already_bowled + balls_in_new_spell <= limit_in_balls.
        If not enough quota remains the selection is rejected.

    RULE 4 / 5 – All overs displays use ball-based arithmetic (÷6 remainder).
    ─────────────────────────────────────────────────────────────────────────
    """

    def __init__(self, state: InningsState, ui: "TerminalUI"):
        self.state = state
        self.ui = ui
        self._snapshots: list[InningsState] = []   # for UNDO

    # ------------------------------------------------------------------
    # PUBLIC ENTRY POINT
    # ------------------------------------------------------------------

    def play(self) -> None:
        """Run the innings until complete."""
        s = self.state
        ui = self.ui

        ui.header(f"INNINGS {s.innings_num}: {s.batting_team.name} BATTING")
        if s.target:
            print(f"  🎯 Target: {s.target} runs\n")

        # Select opening batsmen
        self._select_opening_batsmen()

        while s.active:
            # ── End conditions ──────────────────────────────────────────
            if s.target_chased():
                ui.success(f"🎉 {s.batting_team.name} chases the target!")
                break
            if s.all_out():
                ui.info("All out!")
                break
            if s.innings_balls_remaining() <= 0:
                ui.info("All overs bowled!")
                break

            # ── Bowler spell complete? → select new bowler ───────────────
            # This fires either at the very start OR when a bowler finishes
            # their selected spell (which may have crossed innings boundaries).
            if s.current_bowler is None or s.current_bowler_balls_remaining <= 0:
                result = self._setup_new_bowler_spell()
                if not result:
                    break   # user ended innings
                continue    # re-evaluate end conditions before first ball

            # ── Display current state & take input ───────────────────────
            self._display_match_state()
            cmd = ui.prompt_ball_event()
            self._process_command(cmd)

        # ── Finalise ────────────────────────────────────────────────────
        # Archive any open over slot
        if s.current_over is not None:
            s.completed_overs.append(s.current_over)
            s.current_over = None
        self._finalize_batting_statuses()
        ui.header(f"INNINGS {s.innings_num} COMPLETE")
        print(f"  Score: {s.score_str()} in {s.overs_str()} overs")
        self.display_batting_scorecard()
        self.display_bowling_scorecard()

    # ------------------------------------------------------------------
    # NEW BOWLER SPELL SETUP  (Rule 1 + Rule 2 + Rule 3)
    # ------------------------------------------------------------------

    def _setup_new_bowler_spell(self) -> bool:
        """
        Prompt for a new bowler and over type.
        Returns True if setup succeeded, False if user chose to end innings.

        Rule 2: over-type options depend on remaining innings balls.
        Rule 3: bowler's quota checked in legal balls before accepting.
        """
        s = self.state
        ui = self.ui

        innings_ov_num = s.current_innings_over_num()
        ui.section(f"\n--- INNINGS OVER {innings_ov_num} / BOWLER SPELL ---")

        # ── Select bowler ────────────────────────────────────────────────
        bowler = self._select_bowler()
        if bowler is None:
            return False    # user ended innings

        # ── Determine which over types are available (Rule 2) ────────────
        remaining_balls = s.innings_balls_remaining()

        if remaining_balls <= 0:
            ui.info("No innings balls remaining.")
            return False

        if remaining_balls < 3:
            # Edge case: fewer than 3 balls left — treat as micro-baby
            spell_balls = remaining_balls
            is_baby = True
            print(f"  ⚠  Only {remaining_balls} ball(s) remain in innings — auto Baby Over.")
        elif remaining_balls < 6 or not s.settings.baby_overs_allowed:
            # Only Baby Over fits, OR baby overs not enabled (force baby if < 6 remain)
            if remaining_balls < 6:
                is_baby = True
                spell_balls = 3
                print(f"  ℹ  Only {remaining_balls} innings balls remain — Baby Over only.")
            else:
                # baby overs not allowed; always normal
                is_baby = False
                spell_balls = 6
        else:
            # Both options available (remaining >= 6 and baby overs allowed)
            is_baby = self._select_over_type(remaining_balls)
            spell_balls = 3 if is_baby else 6

        # ── Enforce bowler ball limit (Rule 3) ───────────────────────────
        balls_already = s.bowler_legal_balls_bowled.get(bowler.name, 0)
        limit = s.bowler_balls_limit()
        if balls_already + spell_balls > limit:
            ui.warn(
                f"  ❌ {bowler.name} cannot bowl this over — limit exceeded.\n"
                f"     Already bowled: {balls_already} balls | "
                f"Limit: {limit} balls | Spell needs: {spell_balls} balls.\n"
                f"     Select a different bowler."
            )
            # Reset so the loop re-prompts for a bowler
            return self._setup_new_bowler_spell()

        # ── Commit ───────────────────────────────────────────────────────
        # Open a new innings-over slot object
        over = Over(
            innings_over_num=innings_ov_num,
            bowler=bowler,
            is_baby=is_baby,
        )
        # Override bowler_balls_required if micro-baby edge case
        if remaining_balls < 3:
            over.bowler_balls_required = remaining_balls
            over.bowler_balls_remaining = remaining_balls

        s.current_over = over
        s.current_bowler = bowler
        s.current_bowler_balls_remaining = over.bowler_balls_remaining
        s.bowler_records.setdefault(bowler.name, BowlerRecord(player=bowler))

        print(
            f"  🎳 {bowler.name} to bowl a {over.over_type_str()} "
            f"({over.bowler_balls_remaining} deliveries)"
        )
        return True

    def _select_over_type(self, remaining_innings_balls: int) -> bool:
        """
        Prompt user to choose Baby (3) or Normal (6) over.
        Returns True for baby, False for normal.
        Rule 2: only show Normal if >= 6 innings balls remain.
        """
        ui = self.ui
        print("\n  Select Over Type:")
        print("    1. Baby Over  (3 balls)")
        if remaining_innings_balls >= 6:
            print("    2. Normal Over (6 balls)")
        while True:
            raw = input("  > ").strip()
            if raw == "1":
                return True
            if raw == "2" and remaining_innings_balls >= 6:
                return False
            ui.warn("Invalid choice.")

    def _select_bowler(self) -> Optional[Player]:
        """
        Prompt user to select an eligible bowler.
        Eligibility: has balls remaining under limit AND consecutive rule.
        Shows remaining quota in legal balls.
        """
        s = self.state
        ui = self.ui
        limit = s.bowler_balls_limit()

        eligible = []
        for p in s.bowling_team.players:
            balls_bowled = s.bowler_legal_balls_bowled.get(p.name, 0)
            if balls_bowled >= limit:
                continue    # fully exhausted
            if (
                not s.settings.consecutive_overs_allowed
                and s.last_bowler is not None
                and p == s.last_bowler
                and s.current_bowler_balls_remaining <= 0
            ):
                continue    # cannot bowl consecutive
            eligible.append(p)

        if not eligible:
            ui.warn("No eligible bowlers — consecutive/limit rules relaxed.")
            eligible = s.bowling_team.players[:]

        print("\n  Available Bowlers:")
        for i, p in enumerate(eligible, 1):
            bowled = s.bowler_legal_balls_bowled.get(p.name, 0)
            remaining = limit - bowled
            full_ov = bowled // 6
            rem_b   = bowled % 6
            print(
                f"    {i}. {p.name:<16}  bowled: {full_ov}.{rem_b} ov "
                f"| balls left in quota: {remaining}/{limit}"
            )
        print(f"    0. End Innings")

        while True:
            raw = input("  Select bowler #: ").strip()
            if raw == "0":
                return None
            if raw.isdigit() and 1 <= int(raw) <= len(eligible):
                return eligible[int(raw) - 1]
            ui.warn("Invalid selection.")

    # ------------------------------------------------------------------
    # OPENING BATSMEN
    # ------------------------------------------------------------------

    def _select_opening_batsmen(self) -> None:
        s = self.state
        print("\n  Select Opening Batsmen:")
        avail = s.available_batsmen()
        self._pick_batsman_as_striker(avail, "Striker")
        if not s.settings.single_batting_mode:
            avail2 = s.available_batsmen()
            self._pick_batsman_as_non_striker(avail2, "Non-Striker")

    def _pick_batsman_as_striker(self, avail: list[Player], label: str) -> None:
        s = self.state
        chosen = self.ui.select_player_from_list(avail, f"Select {label}")
        s.striker = chosen
        s.batsmen_records[chosen.name].status = "batting"

    def _pick_batsman_as_non_striker(self, avail: list[Player], label: str) -> None:
        s = self.state
        chosen = self.ui.select_player_from_list(avail, f"Select {label}")
        s.non_striker = chosen
        s.batsmen_records[chosen.name].status = "batting"

    # ------------------------------------------------------------------
    # COMMAND DISPATCHER
    # ------------------------------------------------------------------

    def _process_command(self, cmd: str) -> None:
        cmd = cmd.strip().upper()
        s = self.state

        if cmd == "UNDO":
            self._undo()
            return
        if cmd == "DB":
            self._handle_dead_ball()
            return
        if cmd == "ROTATE":
            if not s.settings.single_batting_mode:
                self._rotate_strike()
                print("  ↔ Strike rotated.")
            else:
                print("  [INFO] Rotation not applicable in Single Batting Mode.")
            return
        if cmd == "RETIRED":
            self._handle_retire()
            return
        if cmd in ("END", "END INNINGS"):
            s.active = False
            return

        # Ball event
        self._save_snapshot()
        self._process_ball(cmd)

    # ------------------------------------------------------------------
    # BALL PROCESSING  (Rule 1 — innings-over boundary handling)
    # ------------------------------------------------------------------

    def _process_ball(self, event: str) -> None:
        s = self.state
        over = s.current_over
        bowler = s.current_bowler

        if over is None or bowler is None:
            print("  [ERR] No active over/bowler.")
            return

        result = self._parse_event(event)
        if result is None:
            print(f"  [ERR] Unknown event: {event}")
            return

        team_runs, batsman_runs, is_legal, is_wicket, rotates = result
        is_nb  = event.startswith("NB")
        is_wd  = event.startswith("WD")
        is_bye = event.startswith("BYE")
        is_lb  = event.startswith("LB")
        is_ro_s  = event.startswith("RO-S")
        is_ro_ns = event.startswith("RO-NS")

        # ── Extras rules ─────────────────────────────────────────────────
        if (is_nb or is_wd) and not s.settings.extras_enabled:
            if is_wd:
                team_runs = 0
                batsman_runs = 0
        if (is_bye or is_lb) and not s.settings.byes_enabled:
            team_runs = 0
            batsman_runs = 0
            is_legal = True

        # ── Score ────────────────────────────────────────────────────────
        s.total_runs += team_runs
        s.extras += (team_runs - batsman_runs)

        # ── Batsman record ───────────────────────────────────────────────
        if s.striker:
            rec = s.batsmen_records[s.striker.name]
            if is_legal:
                rec.balls += 1
            if batsman_runs > 0:
                rec.runs += batsman_runs
                if batsman_runs == 4:
                    rec.fours += 1
                elif batsman_runs == 6:
                    rec.sixes += 1

        # ── Bowler record ────────────────────────────────────────────────
        brec = s.bowler_records.setdefault(bowler.name, BowlerRecord(player=bowler))
        brec.runs_conceded += team_runs
        if is_nb or is_wd:
            brec.extras += (1 if s.settings.extras_enabled else 0)
        if is_legal:
            brec.legal_balls += 1

        # ── Ball counts ──────────────────────────────────────────────────
        if is_legal:
            # COUNTER 1: innings total
            s.legal_balls_total += 1
            # COUNTER 2: this bowler's career balls in this innings
            s.bowler_legal_balls_bowled[bowler.name] = (
                s.bowler_legal_balls_bowled.get(bowler.name, 0) + 1
            )
            # Innings-over slot ball count
            over.innings_legal_balls_in_over += 1
            # Bowler's remaining delivery quota (independent counter)
            s.current_bowler_balls_remaining -= 1

        over.total_balls += 1
        over.runs += team_runs

        # ── Wicket handling ──────────────────────────────────────────────
        if is_wicket and not is_ro_s and not is_ro_ns:
            self._handle_wicket_dismissed(s.striker, bowler, event)
            brec.wickets += 1
        elif is_ro_s:
            self._handle_run_out(striker_out=True,  completed_runs=team_runs, bowler=bowler)
            brec.wickets += 1
        elif is_ro_ns:
            self._handle_run_out(striker_out=False, completed_runs=team_runs, bowler=bowler)
            brec.wickets += 1

        # ── Ball log ─────────────────────────────────────────────────────
        innings_full = s.legal_balls_total // 6
        innings_rem  = s.legal_balls_total % 6
        s.ball_log.append(BallRecord(
            innings_num=s.innings_num,
            over_num=innings_full + (0 if innings_rem > 0 else 0),
            ball_num=innings_rem if is_legal else 0,
            batsman=s.striker.name if s.striker else "-",
            bowler=bowler.name,
            event=event,
            runs=team_runs,
            legal_ball=is_legal,
        ))

        # ── Strike rotation on odd runs ──────────────────────────────────
        if rotates and not is_wicket and not is_ro_s and not is_ro_ns:
            if not s.settings.single_batting_mode:
                self._rotate_strike()

        # ── Print ball summary ───────────────────────────────────────────
        extra_marker = " [NB]" if is_nb else (" [WD]" if is_wd else "")
        print(
            f"  {'●' if is_legal else '○'} {event:<12} "
            f"→ +{team_runs} | Score: {s.score_str()} ({s.overs_str()} ov){extra_marker}"
        )

        # ── RULE 1: Check innings-over boundary ──────────────────────────
        # Fires when the 6-ball boundary is crossed regardless of bowler spell.
        if is_legal and over.innings_legal_balls_in_over >= 6:
            self._handle_innings_over_boundary(over)

        # ── Target check ─────────────────────────────────────────────────
        if s.target_chased():
            s.active = False

    # ------------------------------------------------------------------
    # RULE 1 — INNINGS-OVER BOUNDARY  (independent of bowler spell)
    # ------------------------------------------------------------------

    def _handle_innings_over_boundary(self, completed_over: Over) -> None:
        """
        Called when 6 legal balls have fallen in the current innings-over slot.
        Rotates strike, archives the over slot, and opens a fresh slot.
        The bowler's remaining delivery quota continues uninterrupted.
        """
        s = self.state
        print(f"\n  {'='*48}")
        print(f"  ✅ OVER {completed_over.innings_over_num} COMPLETED  |  Strike Rotated")
        print(f"  {'='*48}")

        # Archive completed over slot
        s.completed_overs.append(completed_over)
        s.last_bowler = completed_over.bowler

        # Auto rotate strike (dual mode)
        if not s.settings.single_batting_mode:
            self._rotate_strike()

        # If bowler still has balls remaining, open a continuation over slot
        # (this is the Rule 1 "Normal Over spans boundary" case)
        if s.current_bowler_balls_remaining > 0:
            new_ov_num = s.current_innings_over_num()
            continuation = Over(
                innings_over_num=new_ov_num,
                bowler=s.current_bowler,
                is_baby=completed_over.is_baby,
            )
            # The continuation slot is not a full fresh spell — just a new
            # innings-over boundary object.  We do NOT reset bowler_balls_remaining
            # here (it lives in s.current_bowler_balls_remaining).
            s.current_over = continuation
            print(
                f"  ↪  {s.current_bowler.name} continues bowling "
                f"({s.current_bowler_balls_remaining} ball(s) remaining in spell)"
            )
        else:
            # Bowler's spell also ended exactly on the boundary
            s.current_over = None
            # Loop will call _setup_new_bowler_spell on next iteration

    # ------------------------------------------------------------------
    # WICKET HANDLERS
    # ------------------------------------------------------------------

    def _handle_wicket_dismissed(
        self, batsman: Optional[Player], bowler: Player, event: str
    ) -> None:
        s = self.state
        if batsman is None:
            return
        s.batsmen_records[batsman.name].status = "out"
        s.dismissed_players.append(batsman)
        s.wickets += 1
        print(f"  ❌ WICKET! {batsman.name} is OUT.")
        s.striker = None
        self._bring_next_batsman(is_striker=True)

    def _handle_run_out(
        self, striker_out: bool, completed_runs: int, bowler: Player
    ) -> None:
        s = self.state
        out_player = s.striker if striker_out else s.non_striker
        if out_player is None:
            return
        s.batsmen_records[out_player.name].status = "out"
        s.dismissed_players.append(out_player)
        s.wickets += 1
        print(f"  ❌ RUN OUT! {out_player.name} is OUT. {completed_runs} run(s) completed.")

        if striker_out:
            s.striker = None
            if completed_runs % 2 == 1 and not s.settings.single_batting_mode:
                s.striker = s.non_striker
                s.non_striker = None
                self._bring_next_batsman(is_striker=False)
            else:
                self._bring_next_batsman(is_striker=True)
        else:
            s.non_striker = None
            if completed_runs % 2 == 1 and not s.settings.single_batting_mode:
                s.non_striker = s.striker
                s.striker = None
                self._bring_next_batsman(is_striker=True)
            else:
                self._bring_next_batsman(is_striker=False)

    def _bring_next_batsman(self, is_striker: bool) -> None:
        s = self.state
        avail = s.available_batsmen()
        if not avail:
            print("  [INFO] No more batsmen available.")
            s.active = False
            return
        label = "New Striker" if is_striker else "New Non-Striker"
        chosen = self.ui.select_player_from_list(avail, f"Select {label}")
        if is_striker:
            s.striker = chosen
        else:
            s.non_striker = chosen
        s.batsmen_records[chosen.name].status = "batting"

    # ------------------------------------------------------------------
    # RETIRE
    # ------------------------------------------------------------------

    def _handle_retire(self) -> None:
        s = self.state
        if s.striker is None:
            print("  [INFO] No striker to retire.")
            return
        player = s.striker
        s.batsmen_records[player.name].status = "retired"
        s.retired_players.append(player)
        s.striker = None
        print(f"  🛑 {player.name} retires not out.")
        self._bring_next_batsman(is_striker=True)

    # ------------------------------------------------------------------
    # ROTATE STRIKE
    # ------------------------------------------------------------------

    def _rotate_strike(self) -> None:
        if self.state.settings.single_batting_mode:
            return
        s = self.state
        s.striker, s.non_striker = s.non_striker, s.striker

    # ------------------------------------------------------------------
    # DEAD BALL
    # ------------------------------------------------------------------

    def _handle_dead_ball(self) -> None:
        s = self.state
        over = s.current_over
        bowler = s.current_bowler
        if over is None or bowler is None:
            return
        over.total_balls += 1
        s.ball_log.append(BallRecord(
            innings_num=s.innings_num,
            over_num=s.legal_balls_total // 6,
            ball_num=0,
            batsman=s.striker.name if s.striker else "-",
            bowler=bowler.name,
            event="DB",
            runs=0,
            legal_ball=False,
            description="Dead Ball",
        ))
        print("  💀 Dead ball recorded (no runs, no ball count).")

    # ------------------------------------------------------------------
    # UNDO
    # ------------------------------------------------------------------

    def _save_snapshot(self) -> None:
        snap = copy.deepcopy(self.state)
        self._snapshots.append(snap)
        if len(self._snapshots) > 10:
            self._snapshots.pop(0)

    def _undo(self) -> None:
        if not self._snapshots:
            print("  [INFO] Nothing to undo.")
            return
        snap = self._snapshots.pop()
        for attr in vars(snap):
            setattr(self.state, attr, getattr(snap, attr))
        print("  ↩ Last ball undone.")

    # ------------------------------------------------------------------
    # FINALIZE
    # ------------------------------------------------------------------

    def _finalize_batting_statuses(self) -> None:
        s = self.state
        for p in s.batting_team.players:
            rec = s.batsmen_records[p.name]
            if rec.status == "batting":
                rec.status = "not out"

    # ------------------------------------------------------------------
    # DISPLAY
    # ------------------------------------------------------------------

    def _display_match_state(self) -> None:
        s = self.state
        over = s.current_over
        bowler_rem = s.current_bowler_balls_remaining
        inn_rem    = s.innings_balls_remaining()

        print(f"\n{THIN}")
        print(
            f"  📊 {s.batting_team.name}:  {s.score_str()}  ({s.overs_str()} ov)  "
            f"| Bowler balls left: {bowler_rem}  | Innings balls left: {inn_rem}"
        )
        if s.target:
            need = max(0, s.target - s.total_runs)
            print(f"  🎯 Target: {s.target} | Need: {need} more run(s)")
        print(
            f"  🏏 Striker: {s.striker.name if s.striker else '---'}"
            f"  |  Non-Striker: {s.non_striker.name if s.non_striker else '---'}"
        )
        print(f"  🎳 Bowler:  {s.current_bowler.name if s.current_bowler else '---'}")
        print(THIN)

    # ------------------------------------------------------------------
    # SCORECARDS
    # ------------------------------------------------------------------

    def display_batting_scorecard(self) -> None:
        s = self.state
        print(f"\n  BATTING SCORECARD — {s.batting_team.name}")
        print(f"  {'Player':<18} {'Status':<12} {'R':>4}  {'B':>4}  {'4s':>4}  {'6s':>4}  {'SR':>7}")
        print(f"  {THIN}")
        for p in s.batting_team.players:
            rec = s.batsmen_records[p.name]
            if rec.status != "yet to bat":
                print(rec.display_row())
        print(f"  {THIN}")
        print(f"  Extras: {s.extras}  |  Total: {s.score_str()}  ({s.overs_str()} ov)")

    def display_bowling_scorecard(self) -> None:
        s = self.state
        print(f"\n  BOWLING SCORECARD — {s.bowling_team.name}")
        print(f"  {'Player':<18} {'Ov':>6}  {'Runs':>5}  {'Wkts':>4}  {'Extras':>6}  {'Econ':>7}")
        print(f"  {THIN}")
        for p in s.bowling_team.players:
            rec = s.bowler_records.get(p.name)
            if rec and rec.legal_balls > 0:
                print(rec.display_row())
        print()

    def display_ball_log(self) -> None:
        s = self.state
        print(f"\n  BALL LOG — Innings {s.innings_num}")
        print(f"  {'Inn':>3} | {'Over':>6} {'L':>2} | {'Batsman':<14} | {'Bowler':<14} | {'Event':<12} | {'Runs':>5}")
        print(f"  {THIN}")
        for b in s.ball_log:
            print(b.display())

    # ------------------------------------------------------------------
    # EVENT PARSER
    # Returns (team_runs, batsman_runs, is_legal, is_wicket, rotates_strike)
    # ------------------------------------------------------------------

    def _parse_event(self, event: str) -> Optional[tuple[int, int, bool, bool, bool]]:
        s = self.state
        ext = s.settings.extras_enabled

        simple = {"0": 0, "1": 1, "2": 2, "3": 3, "4": 4, "6": 6}
        if event in simple:
            r = simple[event]
            return (r, r, True, False, r % 2 == 1)

        if event == "W":
            return (0, 0, True, True, False)

        nb_map = {"NB": 0, "NB+1": 1, "NB+2": 2, "NB+3": 3, "NB+4": 4, "NB+6": 6}
        if event in nb_map:
            bat_r = nb_map[event]
            team_r = bat_r + (1 if ext else 0)
            return (team_r, bat_r, False, False, bat_r % 2 == 1)

        wd_map = {"WD": 0, "WD+1": 1, "WD+2": 2, "WD+3": 3, "WD+4": 4}
        if event in wd_map:
            bat_r = wd_map[event]
            team_r = bat_r + (1 if ext else 0)
            return (team_r, bat_r, False, False, False)

        bye_map = {"BYE+1": 1, "BYE+2": 2, "BYE+3": 3, "BYE+4": 4}
        if event in bye_map:
            r = bye_map[event]
            return (r, 0, True, False, r % 2 == 1)

        lb_map = {"LB+1": 1, "LB+2": 2, "LB+3": 3, "LB+4": 4}
        if event in lb_map:
            r = lb_map[event]
            return (r, 0, True, False, r % 2 == 1)

        ro_s  = {"RO-S+0": 0,  "RO-S+1": 1,  "RO-S+2": 2,  "RO-S+3": 3,  "RO-S+4": 4}
        if event in ro_s:
            return (ro_s[event], ro_s[event], True, False, False)

        ro_ns = {"RO-NS+0": 0, "RO-NS+1": 1, "RO-NS+2": 2, "RO-NS+3": 3, "RO-NS+4": 4}
        if event in ro_ns:
            return (ro_ns[event], ro_ns[event], True, False, False)

        return None


# ==============================================================================
# MATCH
# ==============================================================================

class Match:
    """
    Top-level match controller.
    Handles toss, two innings, winner determination, and summary.
    """

    def __init__(self, team_a: Team, team_b: Team, settings: MatchSettings):
        self.team_a = team_a
        self.team_b = team_b
        self.settings = settings
        self.ui = TerminalUI()
        self.innings_list: list[Innings] = []
        self.toss_winner: Optional[Team] = None
        self.toss_choice: str = ""

    # ------------------------------------------------------------------
    # TOSS
    # ------------------------------------------------------------------

    def conduct_toss(self) -> None:
        ui = self.ui
        ui.header("TOSS")
        teams = [self.team_a, self.team_b]

        print(f"  1. {self.team_a.name}")
        print(f"  2. {self.team_b.name}")
        while True:
            raw = input("  Who calls? (1/2): ").strip()
            if raw in ("1", "2"):
                caller = teams[int(raw) - 1]
                break
            ui.warn("Enter 1 or 2.")

        call = input(f"  {caller.name} calls (H/T): ").strip().upper()
        import random
        result = random.choice(["H", "T"])
        print(f"  Coin lands: {'Heads' if result == 'H' else 'Tails'}")

        if call == result:
            winner = caller
        else:
            winner = self.team_b if caller == self.team_a else self.team_a

        print(f"  🏅 {winner.name} wins the toss!")
        self.toss_winner = winner

        choice = input(f"  {winner.name} chooses to (BAT/BOWL): ").strip().upper()
        self.toss_choice = choice
        print(f"  {winner.name} elected to {choice}.")

    # ------------------------------------------------------------------
    # PLAY MATCH
    # ------------------------------------------------------------------

    def play(self) -> None:
        ui = self.ui
        ui.header("MATCH START")

        # Determine batting order
        if self.toss_choice == "BAT":
            batting_first = self.toss_winner
            bowling_first = self.team_b if batting_first == self.team_a else self.team_a
        else:
            bowling_first = self.toss_winner
            batting_first = self.team_b if bowling_first == self.team_a else self.team_a

        # Innings 1
        state1 = InningsState(
            innings_num=1,
            batting_team=batting_first,
            bowling_team=bowling_first,
            settings=self.settings,
        )
        inn1 = Innings(state1, ui)
        self.innings_list.append(inn1)
        inn1.play()

        first_innings_score = state1.total_runs
        target = first_innings_score + 1
        ui.info(f"  First innings total: {first_innings_score}. Target for {bowling_first.name}: {target}")

        input("\n  Press ENTER to start 2nd innings...")

        # Innings 2
        state2 = InningsState(
            innings_num=2,
            batting_team=bowling_first,
            bowling_team=batting_first,
            settings=self.settings,
            target=target,
        )
        inn2 = Innings(state2, ui)
        self.innings_list.append(inn2)
        inn2.play()

        # Result
        self._calculate_result(state1, state2)

    # ------------------------------------------------------------------
    # RESULT
    # ------------------------------------------------------------------

    def _calculate_result(self, state1: InningsState, state2: InningsState) -> None:
        ui = self.ui
        ui.header("MATCH RESULT")

        t1 = state1.total_runs
        t2 = state2.total_runs

        team1 = state1.batting_team
        team2 = state2.batting_team

        print(f"\n  {team1.name}: {state1.score_str()} ({state1.overs_str()} ov)")
        print(f"  {team2.name}: {state2.score_str()} ({state2.overs_str()} ov)")

        if t2 > t1:
            wkts_left = len(team2.players) - state2.wickets
            ui.success(f"\n  🏆 {team2.name} WON by {wkts_left} wicket(s)!")
        elif t1 > t2:
            margin = t1 - t2
            ui.success(f"\n  🏆 {team1.name} WON by {margin} run(s)!")
        else:
            ui.success("\n  🤝 MATCH TIED!")

        print()
        inn1, inn2 = self.innings_list
        inn1.display_batting_scorecard()
        inn1.display_bowling_scorecard()
        inn2.display_batting_scorecard()
        inn2.display_bowling_scorecard()


# ==============================================================================
# TERMINAL UI
# ==============================================================================

class TerminalUI:
    """
    Handles all terminal I/O: prompts, menus, formatting.
    """

    # ------------------------------------------------------------------
    # FORMATTING
    # ------------------------------------------------------------------

    def header(self, title: str) -> None:
        print(f"\n{LINE}")
        print(f"  {title}")
        print(LINE)

    def section(self, title: str) -> None:
        print(f"\n{title}")

    def success(self, msg: str) -> None:
        print(msg)

    def info(self, msg: str) -> None:
        print(f"  ℹ {msg}")

    def warn(self, msg: str) -> None:
        print(f"  ⚠ {msg}")

    # ------------------------------------------------------------------
    # PROMPTS
    # ------------------------------------------------------------------

    def yes_no(self, prompt: str) -> bool:
        while True:
            raw = input(f"  {prompt} (Y/N): ").strip().upper()
            if raw in ("Y", "YES"):
                return True
            if raw in ("N", "NO"):
                return False
            self.warn("Enter Y or N.")

    def prompt_int(self, prompt: str, min_val: int = 1, max_val: int = 100) -> int:
        while True:
            raw = input(f"  {prompt} ({min_val}-{max_val}): ").strip()
            if raw.isdigit() and min_val <= int(raw) <= max_val:
                return int(raw)
            self.warn(f"Enter a number between {min_val} and {max_val}.")

    def prompt_ball_event(self) -> str:
        """Prompt for a ball event or command."""
        print(
            "\n  Commands: 0 1 2 3 4 6 | NB NB+1 NB+4 NB+6 | "
            "WD WD+1 WD+2 WD+4 | BYE+1..4 | LB+1..4\n"
            "           W | RO-S+0..4 | RO-NS+0..4 | RETIRED | "
            "ROTATE | DB | UNDO | END\n"
            "  Extra menu: SC=Batting SC | BSC=Bowling SC | LOG=Ball Log"
        )
        while True:
            raw = input("  > ").strip().upper()
            if raw in ("SC", "BATTING", "BATTING SC"):
                return "_BATTING_SC"
            if raw in ("BSC", "BOWLING", "BOWLING SC"):
                return "_BOWLING_SC"
            if raw in ("LOG", "BALL LOG"):
                return "_BALL_LOG"
            if raw in VALID_COMMANDS or raw in ("END", "END INNINGS", "_BATTING_SC", "_BOWLING_SC", "_BALL_LOG"):
                return raw
            self.warn(f"Unknown command: {raw}")

    def select_player_from_list(self, players: list[Player], prompt: str) -> Player:
        print(f"\n  {prompt}:")
        for i, p in enumerate(players, 1):
            print(f"    {i}. {p.name}")
        while True:
            raw = input("  Select #: ").strip()
            if raw.isdigit() and 1 <= int(raw) <= len(players):
                return players[int(raw) - 1]
            self.warn("Invalid selection.")


# ==============================================================================
# MATCH SETUP WIZARD
# ==============================================================================

class MatchSetupWizard:
    """
    Interactive wizard to create teams, players, configure settings, conduct toss.
    """

    def __init__(self):
        self.ui = TerminalUI()

    def run(self) -> Match:
        ui = self.ui
        ui.header("GULLY CRICKET SCORING SYSTEM")
        print("  Welcome! Let's set up your match.\n")

        team_a = self._create_team("Team A")
        team_b = self._create_team("Team B")

        self._share_players(team_a, team_b)
        self._transfer_players(team_a, team_b)

        settings = self._configure_settings()
        match = Match(team_a, team_b, settings)
        match.conduct_toss()
        return match

    def _create_team(self, label: str) -> Team:
        ui = self.ui
        ui.section(f"\n--- CREATE {label} ---")
        name = input(f"  Enter name for {label}: ").strip() or label
        team = Team(name)
        count = ui.prompt_int(f"  How many players in {name}?", 2, 15)
        for i in range(count):
            pname = input(f"  Player {i+1} name: ").strip() or f"Player{i+1}"
            team.add_player(Player(pname))
        team.display()
        return team

    def _share_players(self, team_a: Team, team_b: Team) -> None:
        ui = self.ui
        if not ui.yes_no("  Add common players (shared between teams)?"):
            return
        count = ui.prompt_int("  How many common players?", 1, 5)
        for i in range(count):
            pname = input(f"  Common player {i+1} name: ").strip() or f"Common{i+1}"
            p = Player(pname)
            team_a.add_player(p)
            team_b.add_player(p)
            print(f"  ✓ {pname} added to both teams.")

    def _transfer_players(self, team_a: Team, team_b: Team) -> None:
        ui = self.ui
        if not ui.yes_no("  Transfer any player between teams?"):
            return
        teams = {"A": team_a, "B": team_b}
        while True:
            src_key = input("  Transfer FROM (A/B): ").strip().upper()
            if src_key not in teams:
                ui.warn("Enter A or B.")
                continue
            dst_key = "B" if src_key == "A" else "A"
            src, dst = teams[src_key], teams[dst_key]
            src.display()
            raw = input(f"  Select player # to transfer to {dst.name} (0=done): ").strip()
            if raw == "0":
                break
            if raw.isdigit() and 1 <= int(raw) <= len(src.players):
                player = src.players[int(raw) - 1]
                src.transfer_player(player, dst)
            else:
                ui.warn("Invalid.")
            if not ui.yes_no("  Transfer another?"):
                break

    def _configure_settings(self) -> MatchSettings:
        ui = self.ui
        ui.header("MATCH SETTINGS")
        s = MatchSettings()
        s.overs            = ui.prompt_int("  Overs per innings?", 1, 50)
        s.extras_enabled   = ui.yes_no("  Enable Extras (penalty runs for NB/WD)?")
        s.byes_enabled     = ui.yes_no("  Enable Byes / Leg Byes?")
        s.single_batting_mode = ui.yes_no("  Single Batting Mode (1 batsman only)?")
        s.baby_overs_allowed  = ui.yes_no("  Allow Baby Overs (3-ball overs)?")
        s.bowler_over_limit   = ui.prompt_int("  Bowler Over Limit?", 1, 20)
        s.consecutive_overs_allowed = ui.yes_no("  Allow Consecutive Overs by same bowler?")

        print("\n  Match Settings Summary:")
        print(f"    Overs:            {s.overs}")
        print(f"    Extras enabled:   {s.extras_enabled}")
        print(f"    Byes enabled:     {s.byes_enabled}")
        print(f"    Single batting:   {s.single_batting_mode}")
        print(f"    Baby overs:       {s.baby_overs_allowed}")
        print(f"    Bowler limit:     {s.bowler_over_limit}")
        print(f"    Consecutive overs:{s.consecutive_overs_allowed}")
        return s


# ==============================================================================
# MAIN ENTRY POINT — also handles in-game menu commands
# ==============================================================================

def _patch_innings_process_command() -> None:
    """
    Monkey-patch Innings._process_command to handle scorecard
    display commands returned by prompt_ball_event.
    Keeps the engine clean.
    """
    original = Innings._process_command

    def patched(self: Innings, cmd: str) -> None:
        if cmd == "_BATTING_SC":
            self.display_batting_scorecard()
        elif cmd == "_BOWLING_SC":
            self.display_bowling_scorecard()
        elif cmd == "_BALL_LOG":
            self.display_ball_log()
        else:
            original(self, cmd)

    Innings._process_command = patched  # type: ignore[method-assign]


def main() -> None:
    """Main entry point."""
    _patch_innings_process_command()
    wizard = MatchSetupWizard()
    match = wizard.run()
    match.play()


# ==============================================================================
# SAMPLE EXECUTION FLOW (Quick Demo)
# ==============================================================================

def demo_quick_match() -> None:
    """
    Non-interactive demo: creates teams, settings, and simulates
    a basic 2-over match with hard-coded inputs.
    Useful for testing in Google Colab.

    Over-type is now a numbered menu (1=Baby, 2=Normal) not Y/N.
    Bowler limit is in overs; system converts to balls internally.
    """
    import io, sys

    demo_input = "\n".join([
        # Team A: 4 players
        "Warriors",
        "4",
        "Virat", "Rohit", "Dhoni", "Bumrah",
        # Team B: 4 players
        "Challengers",
        "4",
        "Kohli", "Gayle", "Sachin", "Zaheer",
        # No common players
        "N",
        # No transfers
        "N",
        # Match settings
        "2",    # overs per innings
        "N",    # extras disabled
        "N",    # byes disabled
        "N",    # single batting mode off
        "Y",    # baby overs allowed
        "1",    # bowler over limit = 1 (= 6 balls)
        "N",    # consecutive overs not allowed
        # Toss
        "1",    # Warriors call
        "H",    # call heads
        "BAT",  # Warriors bat first
        # ── Innings 1 ──────────────────────────────────────────────────
        # Opening batsmen
        "1",    # Virat (striker)
        "2",    # Rohit (non-striker)
        # Bowler spell 1 (Kohli, Normal Over = 6 balls)
        "1",    # select Kohli
        "2",    # Normal Over
        # Balls 1-6
        "4", "6", "1", "2", "0", "W",
        # New batsman after wicket
        "1",    # Dhoni comes in
        # Bowler spell 2 (Gayle, Normal Over = 6 balls)
        "2",    # select Gayle
        "2",    # Normal Over
        # Balls 1-6
        "2", "4", "1", "1", "0", "0",
        # End innings
        "END",
        # ── Innings 2 ──────────────────────────────────────────────────
        "",     # press enter
        # Opening batsmen
        "1",    # Kohli (striker)
        "2",    # Gayle (non-striker)
        # Bowler spell 1 (Virat, Normal Over = 6 balls)
        "1",    # select Virat
        "2",    # Normal Over
        "2", "4", "6", "0", "1", "1",
        # Bowler spell 2 (Rohit, Normal Over)
        "2",    # select Rohit
        "2",
        "4", "6", "2", "1", "0", "0",
        "END",
    ])

    old_stdin = sys.stdin
    sys.stdin = io.StringIO(demo_input)

    try:
        _patch_innings_process_command()
        wizard = MatchSetupWizard()
        match = wizard.run()
        match.play()
    except EOFError:
        print("\n[DEMO] Input exhausted — demo complete.")
    finally:
        sys.stdin = old_stdin


# ==============================================================================

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "--demo":
        demo_quick_match()
    else:
        main()