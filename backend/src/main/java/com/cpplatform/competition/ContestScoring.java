package com.cpplatform.competition;

import java.time.*;
import java.util.*;

/**
 * Pure scoreboard calculation for every supported scoring system. Judging completion
 * order never affects results: only submission time, verdict and passed tests count.
 * Pending, frozen and judge-error submissions never score or penalize.
 */
public final class ContestScoring {
    public static final List<String> SYSTEMS=List.of("ICPC","IOI","CODEFORCES","ATCODER");
    public record Submission(UUID id,UUID entry,int slot,Instant submitted,String verdict,int passed,int total) {}
    public record Cell(int slot,boolean solved,int attempts,long solveSeconds,boolean frozen,double score) {}
    public record Row(int rank,UUID entry,int solved,double score,Long penaltySeconds,List<Cell> problems) {}
    public record Stat(int slot,int solved,int tried) {}
    public record Board(String system,Map<Integer,Integer> points,List<Row> rows,List<Stat> stats) {}
    private ContestScoring() {}

    /** Default points when the organizer set none: IOI 100 each, Codeforces 500, 1000, ..., AtCoder 100, 200, ... */
    public static int defaultPoints(String system,int position) {
        return switch(system) {
            case "IOI" -> 100;
            case "CODEFORCES" -> 500*(position+1);
            case "ATCODER" -> 100*(position+1);
            default -> 1;
        };
    }

    public static Board calculate(String system,List<UUID> entries,List<Integer> slots,Map<Integer,Integer> configuredPoints,
                                  List<Submission> submissions,Instant starts,Instant freeze,long wrongPenalty,boolean penalizeCE) {
        Map<Integer,Integer> points=new LinkedHashMap<>();
        for(int i=0;i<slots.size();i++)points.put(slots.get(i),configuredPoints.getOrDefault(slots.get(i),defaultPoints(system,i)));
        Map<UUID,Map<Integer,List<Submission>>> grouped=new HashMap<>();
        for(Submission s:submissions)grouped.computeIfAbsent(s.entry,k->new HashMap<>()).computeIfAbsent(s.slot,k->new ArrayList<>()).add(s);
        record Scored(UUID entry,int solved,double score,long penalty,List<Cell> cells) {}
        List<Scored> scored=new ArrayList<>();
        for(UUID entry:entries) {
            int solved=0;double total=0;long penalty=0,lastScore=0,atcoderWrong=0;List<Cell> cells=new ArrayList<>();
            for(int slot:slots) {
                var ordered=grouped.getOrDefault(entry,Map.of()).getOrDefault(slot,List.of()).stream()
                        .sorted(Comparator.comparing(Submission::submitted).thenComparing(Submission::id)).toList();
                int attempts=0,wrong=0;boolean accepted=false,frozen=false;long solveSeconds=0;double best=0;
                int p=points.get(slot);
                for(Submission s:ordered) {
                    if(freeze!=null && !s.submitted.isBefore(freeze)){frozen=true;continue;}
                    if(s.verdict==null || s.verdict.equals("JUDGE_ERROR"))continue;
                    long seconds=Math.max(0,Duration.between(starts,s.submitted).getSeconds());
                    if(system.equals("IOI")) {
                        attempts++;
                        double value=s.verdict.equals("COMPILATION_ERROR") || s.total<=0?0:Math.round(100.0*p*s.passed/s.total)/100.0;
                        if(value>best){best=value;solveSeconds=seconds;}
                        if(s.verdict.equals("ACCEPTED"))accepted=true;
                        continue;
                    }
                    if(accepted)continue;
                    // Unpenalized compilation errors are not attempts: the board shows exactly what is penalized.
                    if(s.verdict.equals("COMPILATION_ERROR") && !penalizeCE)continue;
                    attempts++;
                    if(s.verdict.equals("ACCEPTED")) {
                        accepted=true;solveSeconds=seconds;
                        best=switch(system) {
                            case "CODEFORCES" -> Math.round(Math.max(0.3*p,p-(p/250.0)*(seconds/60)-50.0*wrong));
                            case "ATCODER" -> p;
                            default -> 1;
                        };
                    } else if(!s.verdict.equals("COMPILATION_ERROR") || penalizeCE)wrong++;
                }
                if(system.equals("IOI")) {
                    total+=best;if(best>=p)solved++;
                } else if(accepted) {
                    solved++;total+=best;
                    if(system.equals("ICPC"))penalty+=solveSeconds+wrong*wrongPenalty;
                    if(system.equals("ATCODER")){lastScore=Math.max(lastScore,solveSeconds);atcoderWrong+=wrong;}
                }
                cells.add(new Cell(slot,system.equals("IOI")?best>=p:accepted,attempts,solveSeconds,frozen && !(system.equals("IOI")?best>=p:accepted),best));
            }
            if(system.equals("ATCODER"))penalty=lastScore+300*atcoderWrong;
            scored.add(new Scored(entry,solved,total,penalty,cells));
        }
        Comparator<Scored> order=switch(system) {
            case "ICPC" -> Comparator.comparingInt(Scored::solved).reversed().thenComparingLong(Scored::penalty);
            case "ATCODER" -> Comparator.comparingDouble(Scored::score).reversed().thenComparingLong(Scored::penalty);
            default -> Comparator.comparingDouble(Scored::score).reversed();
        };
        scored.sort(order.thenComparing(Scored::entry));
        List<Row> rows=new ArrayList<>();
        for(int i=0;i<scored.size();i++) {
            var s=scored.get(i);
            // ICPC keeps distinct ranks (deterministic tie break); points systems share ranks on exact ties.
            int rank=i+1;
            if(!system.equals("ICPC") && i>0 && order.compare(scored.get(i-1),s)==0)rank=rows.get(i-1).rank();
            rows.add(new Row(rank,s.entry,s.solved,s.score,system.equals("ICPC") || system.equals("ATCODER")?s.penalty:null,s.cells));
        }
        List<Stat> stats=new ArrayList<>();
        for(int i=0;i<slots.size();i++) {
            int slot=slots.get(i),solvedBy=0,triedBy=0;
            for(var s:scored){var c=s.cells.get(i);if(c.solved())solvedBy++;if(c.attempts()>0)triedBy++;}
            stats.add(new Stat(slot,solvedBy,triedBy));
        }
        return new Board(system,points,rows,stats);
    }
}
