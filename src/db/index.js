import mongoose from "mongoose";
import { DB_NAME } from "../constants.js";
import dotenv from "dotenv";
dotenv.config();
const connectDB = async () => {
    
    try {
        console.log("Outside the DB function1");
        console.log("DB url--.",process.env.MONGODB_URI);
        
        const connectionInstance = await mongoose.connect(process.env.MONGODB_URI);
        
        console.log("Response is -->",connectionInstance);
        console.log(`\n MongoDB connected !! DB HOST: ${connectionInstance.connection.host}`);
    } catch (error) {
        console.log("MONGODB connection FAILED ", error);
        process.exit(1)
    }
}
export default connectDB