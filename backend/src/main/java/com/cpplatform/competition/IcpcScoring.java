package com.cpplatform.competition;

import java.time.*;
import java.util.*;

/** Pure scoring: judging completion order never affects ranking or penalties. */
public final class IcpcScoring {
    public record Submission(UUID id,UUID entry,int slot,Instant submitted,String verdict) {}
    public record Problem(int slot,boolean solved,int attempts,long solveSeconds,boolean frozen) {}
    public record Standing(int rank,UUID entry,int solved,long penaltySeconds,List<Problem> problems) {}
    private IcpcScoring() {}
    public static List<Standing> calculate(List<UUID> entries,List<Integer> slots,List<Submission> submissions,
            Instant starts,Instant freeze,long wrongPenalty,boolean penalizeCE) {
        List<Standing> result=new ArrayList<>();
        Map<UUID,Map<Integer,List<Submission>>> grouped=new HashMap<>();
        for(Submission s:submissions)grouped.computeIfAbsent(s.entry,k->new HashMap<>()).computeIfAbsent(s.slot,k->new ArrayList<>()).add(s);
        for(UUID entry:entries) {
            int solved=0;long penalty=0;List<Problem> problems=new ArrayList<>();
            for(int slot:slots) {
                var ordered=grouped.getOrDefault(entry,Map.of()).getOrDefault(slot,List.of()).stream()
                        .sorted(Comparator.comparing(Submission::submitted).thenComparing(Submission::id)).toList();
                int attempts=0,wrong=0;boolean accepted=false,frozen=false;long solveSeconds=0;
                for(Submission s:ordered) {
                    if(freeze!=null && !s.submitted.isBefore(freeze)) {frozen=true;continue;}
                    if(accepted)continue;
                    if(s.verdict==null || s.verdict.equals("JUDGE_ERROR"))continue;
                    attempts++;
                    if(s.verdict.equals("ACCEPTED")) {
                        accepted=true;solveSeconds=Math.max(0,Duration.between(starts,s.submitted).getSeconds());
                        solved++;penalty+=solveSeconds+wrong*wrongPenalty;
                    } else if(!s.verdict.equals("COMPILATION_ERROR") || penalizeCE)wrong++;
                }
                problems.add(new Problem(slot,accepted,attempts,solveSeconds,!accepted&&frozen));
            }
            result.add(new Standing(0,entry,solved,penalty,problems));
        }
        result.sort(Comparator.comparingInt(Standing::solved).reversed()
                .thenComparingLong(Standing::penaltySeconds).thenComparing(Standing::entry));
        List<Standing> ranked=new ArrayList<>();
        for(int i=0;i<result.size();i++){var s=result.get(i);ranked.add(new Standing(i+1,s.entry,s.solved,s.penaltySeconds,s.problems));}
        return ranked;
    }
}
