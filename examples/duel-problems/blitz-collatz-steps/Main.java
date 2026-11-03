import java.io.*;
import java.util.*;

public class Main {
    public static void main(String[] args) throws IOException {
        long x = Long.parseLong(new BufferedReader(new InputStreamReader(System.in)).readLine().trim());
        int steps = 0;
        while (x != 1) { x = (x % 2 == 0) ? x / 2 : 3 * x + 1; ++steps; }
        System.out.println(steps);
    }
}
